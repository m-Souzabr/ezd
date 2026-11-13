"""The photo test set: each photo in evals/photos/ with its ground truth, run through the
same code path as the analyze endpoint (`photos.analysis.analyze`) and scored.

Ground truth (`<name>.json`) is `{ shape, walls: [{ lengthIn, openings: [kind], items:
[category] }] }`, with walls left to right as the photo shows them. An answer's openings and
items are matched to it by the position of their wall among the walls the model saw, and by
kind or category: the model's labels are its own.
"""

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from django.conf import settings

from chat.evals import Call, cost_usd
from llm.client import LLMClient, PhotoRequest, PhotoResponse

from .analysis import analyze
from .images import process_upload


class MeteredPhotoClient:
    """Passes photo calls through and keeps each answer, for the report and recordings."""

    def __init__(self, client: LLMClient) -> None:
        self.client = client
        self.calls: list[Call] = []
        self.responses: list[PhotoResponse] = []

    def analyze_photo(self, request: PhotoRequest) -> PhotoResponse:
        response = self.client.analyze_photo(request)
        self.calls.append(Call(model=response.model or request.model, usage=response.usage))
        self.responses.append(response)
        return response


@dataclass
class PhotoResult:
    name: str
    schema_valid: bool
    valid_first: bool
    attempts: int
    shape: str | None
    expected_shape: str
    openings: tuple[int, int, int]  # matched, found, expected
    items: tuple[int, int, int]
    calls: list[Call] = field(default_factory=list)
    responses: list[PhotoResponse] = field(default_factory=list)

    @property
    def shape_correct(self) -> bool:
        return self.schema_valid and self.shape == self.expected_shape


def _found(answer: dict[str, Any], key: str, field_name: str) -> Counter:
    """(wall position, kind) for each opening or item, among the walls the model saw."""
    seen = [wall["label"] for wall in answer.get("walls", []) if wall.get("visible")]
    found: Counter = Counter()
    for entry in answer.get(key, []):
        if entry.get("wall") in seen:
            found[(seen.index(entry["wall"]), entry[field_name])] += 1
    return found


def _expected(truth: dict[str, Any], key: str) -> Counter:
    return Counter((index, kind) for index, wall in enumerate(truth["walls"]) for kind in wall[key])


def _match(found: Counter, expected: Counter) -> tuple[int, int, int]:
    return sum((found & expected).values()), sum(found.values()), sum(expected.values())


def run_photo(
    name: str, image: bytes, truth: dict[str, Any], client: LLMClient, model: str, escalation: str
) -> PhotoResult:
    metered = MeteredPhotoClient(client)
    photo = process_upload(image)
    result = analyze(metered, photo.content, model, escalation)
    answer = result.model_output if result.ok and isinstance(result.model_output, dict) else {}
    return PhotoResult(
        name=name,
        schema_valid=result.ok,
        valid_first=result.ok and len(result.attempts) == 1,
        attempts=len(result.attempts),
        shape=answer.get("shape"),
        expected_shape=truth["shape"],
        openings=_match(_found(answer, "openings", "kind"), _expected(truth, "openings")),
        items=_match(_found(answer, "items", "category"), _expected(truth, "items")),
        calls=metered.calls,
        responses=metered.responses,
    )


def load_set(directory: Path, names: list[str] | None = None) -> list[tuple[str, bytes, dict]]:
    """Every photo with a ground truth file, by name."""
    photos = []
    for truth_path in sorted(directory.glob("*.json")):
        name = truth_path.stem
        if names and name not in names:
            continue
        candidates = (directory / f"{name}{ext}" for ext in (".jpg", ".png", ".webp"))
        image = next((path for path in candidates if path.exists()), None)
        if image is None:
            continue
        photos.append((name, image.read_bytes(), json.loads(truth_path.read_text("utf-8"))))
    return photos


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def report(results: list[PhotoResult], meta: dict[str, Any]) -> dict[str, Any]:
    n = len(results) or 1
    calls = [call for result in results for call in result.calls]
    costs = [cost_usd(result.calls, settings.LLM_PRICES) for result in results]
    known = None not in costs
    total_cost = sum(c for c in costs if c is not None) if known else None

    def totals(key: str) -> dict[str, float | None]:
        matched = sum(getattr(r, key)[0] for r in results)
        found = sum(getattr(r, key)[1] for r in results)
        expected = sum(getattr(r, key)[2] for r in results)
        return {"precision": _ratio(matched, found), "recall": _ratio(matched, expected)}

    return {
        **meta,
        "photos": len(results),
        "schema_valid_rate": sum(r.schema_valid for r in results) / n,
        "schema_valid_first_rate": sum(r.valid_first for r in results) / n,
        "shape_accuracy": sum(r.shape_correct for r in results) / n,
        "openings": totals("openings"),
        "items": totals("items"),
        "tokens": {
            "input": sum(c.usage.input_tokens for c in calls),
            "cached": sum(c.usage.cached_tokens for c in calls),
            "output": sum(c.usage.output_tokens for c in calls),
        },
        "tokens_per_photo": sum(c.usage.input_tokens + c.usage.output_tokens for c in calls) / n,
        "cost_usd": total_cost,
        "cost_per_photo_usd": total_cost / n if total_cost is not None else None,
        "results": [
            {
                "name": r.name,
                "schema_valid": r.schema_valid,
                "attempts": r.attempts,
                "shape": r.shape,
                "expected_shape": r.expected_shape,
                "openings": dict(zip(("matched", "found", "expected"), r.openings, strict=True)),
                "items": dict(zip(("matched", "found", "expected"), r.items, strict=True)),
                "models": [c.model for c in r.calls],
            }
            for r in results
        ],
    }


def markdown(data: dict[str, Any]) -> str:
    def pct(value: float | None) -> str:
        return "n/a" if value is None else f"{value * 100:.1f}%"

    def money(value: float | None) -> str:
        return "n/a (a model has no price in LLM_PRICES)" if value is None else f"${value:.4f}"

    lines = [
        f"# Photo eval run: {data['client']} ({data['vendor']})",
        "",
        f"Models: vision `{data['models']['vision']}`, escalation `{data['models']['escalation']}`",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| Photos | {data['photos']} |",
        f"| Schema-valid, after retries | {pct(data['schema_valid_rate'])} |",
        f"| Schema-valid, first attempt | {pct(data['schema_valid_first_rate'])} |",
        f"| Shape accuracy | {pct(data['shape_accuracy'])} |",
        f"| Openings precision / recall | {pct(data['openings']['precision'])} / "
        f"{pct(data['openings']['recall'])} |",
        f"| Items precision / recall | {pct(data['items']['precision'])} / "
        f"{pct(data['items']['recall'])} |",
        f"| Tokens per photo | {data['tokens_per_photo']:.0f} |",
        f"| Cost | {money(data['cost_usd'])} |",
        f"| Cost per photo | {money(data['cost_per_photo_usd'])} |",
        "",
        "| Photo | Valid | Attempts | Shape (expected) | Openings | Items |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in data["results"]:
        o, i = r["openings"], r["items"]
        lines.append(
            f"| {r['name']} | {'yes' if r['schema_valid'] else 'NO'} | {r['attempts']} | "
            f"{r['shape']} ({r['expected_shape']}) | {o['matched']}/{o['found']}/{o['expected']} | "
            f"{i['matched']}/{i['found']}/{i['expected']} |"
        )
    lines += ["", "Openings and items: matched / found / expected."]
    return "\n".join(lines) + "\n"

"""The assistant's eval suite: cases in evals/cases.json, run through the same code path as
the chat endpoint (`chat.services.run_attempt`), then checked with `ezd-core`.

A case is `{ name, document, message, expect }`: `document` is a path under evals/, and
`expect` a list of assertions with lengths in inches (see `ASSERTIONS`).
"""

import json
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from django.conf import settings

from llm.client import LLMClient, ProposeRequest, ProposeResponse, Usage
from llm.config import Models

from .services import MAX_RETRIES, AttemptInput, run_attempt

IN = 16
CLI_TIMEOUT_SECONDS = 30
BANDS = {"base": (0, 552), "wall": (864, 1344)}

Document = dict[str, Any]


def core(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Runs one `ezd-core` command on a JSON payload and returns its JSON answer."""
    result = subprocess.run(
        [*settings.EZD_CORE_CLI, command],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=CLI_TIMEOUT_SECONDS,
        check=False,
    )
    return json.loads(result.stdout)


@dataclass
class Call:
    model: str
    usage: Usage


class MeteredClient:
    """Passes calls through and keeps the model and tokens of each, for the cost report."""

    def __init__(self, client: LLMClient) -> None:
        self.client = client
        self.calls: list[Call] = []
        self.responses: list[ProposeResponse] = []

    def propose(self, request: ProposeRequest) -> ProposeResponse:
        response = self.client.propose(request)
        self.calls.append(Call(model=response.model or request.model, usage=response.usage))
        self.responses.append(response)
        return response


# --- assertions --------------------------------------------------------------------------


def _labels(document: Document) -> dict[str, str]:
    """Wall id to its label: A, B, C in document order."""
    return {wall["id"]: chr(65 + i) for i, wall in enumerate(document["room"]["walls"])}


def _where(document: Document, item: dict[str, Any]) -> str:
    placement = item["placement"]
    return _labels(document)[placement["wallId"]] if placement["type"] == "wall" else "free"


def _items(document: Document, catalog_id: str | None = None, wall: str | None = None) -> list:
    found = [
        item
        for item in document["items"]
        if (catalog_id is None or item["catalogId"] == catalog_id)
        and (wall is None or _where(document, item) == wall)
    ]
    return sorted(found, key=lambda item: (item["placement"].get("offset", 0), item["elevation"]))


def _inches(value: int) -> float:
    return value / IN


@dataclass
class Outcome:
    before: Document
    after: Document
    proposed: bool
    question: str
    new_errors: list[str]


def _count(outcome: Outcome, a: dict[str, Any]) -> str | None:
    n = len(_items(outcome.after, a.get("catalogId"), a.get("wall")))
    return None if n == a["equals"] else f"expected {a['equals']}, found {n}"


def _item(outcome: Outcome, a: dict[str, Any]) -> str | None:
    items = _items(outcome.after, a["catalogId"], a.get("wall"))
    index = a.get("index", 0)
    if len(items) <= index:
        return "no such item"
    item = items[index]
    actual = {
        "widthIn": _inches(item["width"]),
        "heightIn": _inches(item["height"]),
        "depthIn": _inches(item["depth"]),
        "elevationIn": _inches(item["elevation"]),
        "offsetIn": _inches(item["placement"].get("offset", 0)),
        "finishId": item.get("finishId"),
    }
    for key, value in actual.items():
        if key in a and a[key] != value:
            return f"{key} is {value}, expected {a[key]}"
    for key, value in a.get("options", {}).items():
        if item["options"].get(key) != value:
            return f"option {key} is {item['options'].get(key)!r}, expected {value!r}"
    return None


def _run_length(outcome: Outcome, a: dict[str, Any]) -> str | None:
    bottom, top = BANDS[a["band"]]
    total = sum(
        item["width"]
        for item in _items(outcome.after, wall=a["wall"])
        if item["elevation"] < top and item["elevation"] + item["height"] > bottom
    )
    return None if _inches(total) == a["equalsIn"] else f"run is {_inches(total)} in"


def _openings(outcome: Outcome, a: dict[str, Any]) -> list[dict[str, Any]]:
    labels = _labels(outcome.after)
    return [
        o
        for o in outcome.after["room"]["openings"]
        if labels[o["wallId"]] == a["wall"] and o["kind"] == a["kind"]
    ]


def _opening(outcome: Outcome, a: dict[str, Any]) -> str | None:
    found = _openings(outcome, a)
    if not found:
        return "no such opening"
    width = _inches(found[0]["width"])
    return None if width == a["widthIn"] else f"width is {width}"


def _countertops(outcome: Outcome, a: dict[str, Any]) -> str | None:
    labels = _labels(outcome.after)
    n = sum(1 for top in outcome.after["countertops"] if labels[top["wallId"]] == a["wall"])
    return None if n >= a["atLeast"] else f"{n} countertops"


ASSERTIONS: dict[str, Callable[[Outcome, dict[str, Any]], str | None]] = {
    "count": _count,
    "item": _item,
    "run_length": _run_length,
    "opening_count": lambda o, a: (
        None if len(_openings(o, a)) == a["equals"] else f"{len(_openings(o, a))} openings"
    ),
    "opening": _opening,
    "countertops": _countertops,
    "finish": lambda o, a: (
        None
        if o.after["finishes"].get(a["target"]) == a["equals"]
        else f"finish is {o.after['finishes'].get(a['target'])}"
    ),
    "total_items": lambda o, a: (
        None if len(o.after["items"]) == a["equals"] else f"{len(o.after['items'])} items"
    ),
    "no_new_errors": lambda o, a: "; ".join(o.new_errors) or None,
    "asked_question": lambda o, a: None if o.question else "no question was asked",
    "declined": lambda o, a: "a change was proposed" if o.proposed else None,
    "unchanged": lambda o, a: None if o.after == o.before else "the design changed",
}


# --- one case ----------------------------------------------------------------------------


def error_for_model(error: dict[str, Any]) -> str:
    """As the browser words a dry-run error (`errorForModel` in the web app)."""
    if error["toolIndex"] >= 0:
        return f"Tool call {error['toolIndex'] + 1} ({error['tool']}): {error['message']}"
    return error["message"]


@dataclass
class CaseResult:
    name: str
    passed: bool
    failures: list[str]
    outcome: str
    attempts: int
    valid_first: bool
    valid_after: bool
    calls: list[Call] = field(default_factory=list)
    responses: list[ProposeResponse] = field(default_factory=list)


def run_case(case: dict[str, Any], client: LLMClient, models: Models) -> CaseResult:
    document = json.loads((Path(settings.EVALS_DIR) / case["document"]).read_text("utf-8"))
    metered = MeteredClient(client)
    summary = core("llm-summary", {"document": document})
    after, proposed, question, kind = document, False, "", "failed"
    errors: list[str] = []
    previous: list[dict[str, Any]] = []
    category: str | None = None
    command = None
    attempt = 0
    for attempt in range(MAX_RETRIES + 1):
        result = run_attempt(
            metered,
            models,
            AttemptInput(
                message=case["message"],
                summary=summary["text"],
                attempt=attempt,
                previous_tool_calls=previous,
                errors=errors,
                category=category,
            ),
        )
        # As the retry endpoint does: never back to the router model.
        category = "complex_edit"
        if result.errors:
            errors, previous = result.errors, result.tool_calls
            continue
        if result.question or not result.tool_calls:
            question, kind = result.question, "question" if result.question else "text"
            break
        dry = core(
            "llm-dry-run",
            {"document": document, "toolCalls": result.tool_calls, "aliases": summary["aliases"]},
        )
        if dry["ok"]:
            after, proposed, kind, command = dry["document"], True, "proposal", dry["command"]
            break
        errors = [error_for_model(error) for error in dry["errors"]]
        previous = result.tool_calls
    valid_first = attempt == 0 and kind != "failed"

    new_errors: list[str] = []
    if command is not None:
        # The deterministic check, as the API's own validation runs it.
        checked = core("validate", {"document": document, "commands": command["commands"]})
        new_errors = [v["message"] for v in checked["introduced"] if v["severity"] == "error"]

    outcome = Outcome(document, after, proposed, question, new_errors)
    failures = []
    for assertion in case["expect"]:
        problem = ASSERTIONS[assertion["type"]](outcome, assertion)
        if problem:
            failures.append(f"{assertion['type']}: {problem}")
    return CaseResult(
        name=case["name"],
        passed=not failures,
        failures=failures,
        outcome=kind,
        attempts=attempt + 1,
        valid_first=valid_first,
        valid_after=kind != "failed",
        calls=metered.calls,
        responses=metered.responses,
    )


# --- the report --------------------------------------------------------------------------


def cost_usd(calls: list[Call], prices: dict[str, dict[str, float]]) -> float | None:
    """From prices per million tokens. None if a model has no price."""
    total = 0.0
    for call in calls:
        price = prices.get(call.model)
        if price is None:
            return None
        uncached = call.usage.input_tokens - call.usage.cached_tokens
        total += (
            uncached * price["input"]
            + call.usage.cached_tokens * price.get("cached_input", price["input"])
            + call.usage.output_tokens * price["output"]
        ) / 1_000_000
    return total


def report(results: list[CaseResult], meta: dict[str, Any]) -> dict[str, Any]:
    n = len(results) or 1
    calls = [call for result in results for call in result.calls]
    costs = [cost_usd(result.calls, settings.LLM_PRICES) for result in results]
    known = None not in costs
    accepted = sum(1 for r in results if r.passed and r.outcome == "proposal")
    total_cost = sum(c for c in costs if c is not None) if known else None
    return {
        **meta,
        "cases": len(results),
        "accuracy": sum(r.passed for r in results) / n,
        "valid_proposal_rate_first": sum(r.valid_first for r in results) / n,
        "valid_proposal_rate_after_retries": sum(r.valid_after for r in results) / n,
        "average_retries": sum(r.attempts - 1 for r in results) / n,
        "tokens": {
            "input": sum(c.usage.input_tokens for c in calls),
            "cached": sum(c.usage.cached_tokens for c in calls),
            "output": sum(c.usage.output_tokens for c in calls),
        },
        "cost_usd": total_cost,
        "cost_per_accepted_edit_usd": (
            total_cost / accepted if total_cost is not None and accepted else None
        ),
        "results": [
            {
                "name": r.name,
                "passed": r.passed,
                "outcome": r.outcome,
                "attempts": r.attempts,
                "failures": r.failures,
                "models": [c.model for c in r.calls],
            }
            for r in results
        ],
    }


def markdown(data: dict[str, Any]) -> str:
    def pct(value: float) -> str:
        return f"{value * 100:.1f}%"

    def money(value: float | None) -> str:
        return "n/a (a model has no price in LLM_PRICES)" if value is None else f"${value:.4f}"

    lines = [
        f"# Eval run: {data['client']} ({data['vendor']})",
        "",
        f"Models: router `{data['models']['router']}`, default `{data['models']['default']}`, "
        f"escalation `{data['models']['escalation']}`",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| Cases | {data['cases']} |",
        f"| Accuracy | {pct(data['accuracy'])} |",
        f"| Valid proposals, first attempt | {pct(data['valid_proposal_rate_first'])} |",
        f"| Valid proposals, after retries | {pct(data['valid_proposal_rate_after_retries'])} |",
        f"| Average retries | {data['average_retries']:.2f} |",
        f"| Input tokens (cached) | {data['tokens']['input']} ({data['tokens']['cached']}) |",
        f"| Output tokens | {data['tokens']['output']} |",
        f"| Cost | {money(data['cost_usd'])} |",
        f"| Cost per accepted edit | {money(data['cost_per_accepted_edit_usd'])} |",
        "",
        "| Case | Result | Outcome | Attempts | Failures |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in data["results"]:
        failures = "; ".join(r["failures"]).replace("|", "\\|")
        result = "pass" if r["passed"] else "FAIL"
        lines.append(f"| {r['name']} | {result} | {r['outcome']} | {r['attempts']} | {failures} |")
    return "\n".join(lines) + "\n"

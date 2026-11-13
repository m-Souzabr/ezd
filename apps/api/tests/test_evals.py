"""The eval runner, on the recorded fake responses and on cases made up here."""

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command

from chat.evals import Call, cost_usd
from llm.client import Usage


def run(tmp_path: Path, *args: str) -> dict[str, Any]:
    call_command("run_evals", "--client", "fake", "--out", str(tmp_path), *args)
    return json.loads((tmp_path / "report.json").read_text("utf-8"))


def test_the_recorded_suite_passes_and_reports_every_metric(tmp_path: Path) -> None:
    data = run(tmp_path, "--min-accuracy", "1")
    assert data["cases"] >= 40
    assert data["accuracy"] == 1.0
    assert data["valid_proposal_rate_after_retries"] == 1.0
    assert data["valid_proposal_rate_first"] < 1.0  # The retry cases fail once on purpose.
    assert data["average_retries"] > 0
    assert data["cost_per_accepted_edit_usd"] > 0
    markdown = (tmp_path / "report.md").read_text("utf-8")
    assert "| Valid proposals, after retries | 100.0% |" in markdown


def test_a_retry_escalates_only_on_the_last_attempt(tmp_path: Path) -> None:
    data = run(tmp_path, "--case", "retry-after-overlap")
    [result] = data["results"]
    assert result["attempts"] == 2
    # Router, the simple edit on the router model, then the retry on the default model.
    assert result["models"] == ["gpt-5.4-nano", "gpt-5.4-nano", "gpt-5.4-mini"]


def test_the_injection_case_behaves_like_the_plain_one(tmp_path: Path) -> None:
    data = run(tmp_path, "--case", "injection-name", "--case", "countertops")
    assert [r["outcome"] for r in data["results"]] == ["proposal", "proposal"]
    assert all(r["passed"] for r in data["results"])


@pytest.fixture
def evals_dir(tmp_path: Path, settings: Any) -> Path:
    """A copy of the documents, with cases and recordings written by the test."""
    root = tmp_path / "evals"
    shutil.copytree(Path(settings.EVALS_DIR) / "documents", root / "documents")
    (root / "recordings" / "fake").mkdir(parents=True)
    settings.EVALS_DIR = str(root)
    return root


def write_case(root: Path, name: str, expect: list, calls: list[dict]) -> None:
    case = {"name": name, "document": "documents/galley.json", "message": "x", "expect": expect}
    cases_file = root / "cases.json"
    cases = json.loads(cases_file.read_text()) if cases_file.exists() else []
    cases_file.write_text(json.dumps([*cases, case]))
    router = {
        "tool_calls": [{"name": "classify_request", "arguments": {"category": "simple_edit"}}]
    }
    responses = [router, *({"tool_calls": c} for c in calls)]
    (root / "recordings" / "fake" / f"{name}.json").write_text(json.dumps({"responses": responses}))


def test_failed_assertions_are_reported_and_fail_the_run(evals_dir: Path, tmp_path: Path) -> None:
    overlap = [
        {
            "name": "add_item",
            "arguments": {"catalogId": "base.standard", "widthIn": 30, "wall": "A", "offsetIn": 0},
        }
    ]
    write_case(
        evals_dir,
        "always-overlaps",
        [
            {"type": "count", "catalogId": "base.standard", "equals": 2},
            {"type": "asked_question"},
            {"type": "unchanged"},
        ],
        [overlap, overlap, overlap],
    )
    write_case(
        evals_dir,
        "wrong-sizes",
        [
            {"type": "item", "catalogId": "base.drawers", "wall": "A", "widthIn": 27},
            {"type": "item", "catalogId": "base.drawers", "wall": "A", "options": {"drawers": 4}},
            {"type": "item", "catalogId": "base.drawers", "wall": "A", "index": 3},
            {"type": "run_length", "wall": "A", "band": "wall", "equalsIn": 10},
            {"type": "opening", "wall": "C", "kind": "door", "widthIn": 30},
            {"type": "opening", "wall": "B", "kind": "door", "widthIn": 30},
            {"type": "opening_count", "wall": "A", "kind": "window", "equals": 0},
            {"type": "countertops", "wall": "A", "atLeast": 1},
            {"type": "finish", "target": "floor", "equals": "floor.oak"},
            {"type": "total_items", "equals": 1},
            {"type": "declined"},
        ],
        [[{"name": "resize_item", "arguments": {"item": "c4", "widthIn": 30}}]],
    )
    with pytest.raises(CommandError, match="below"):
        call_command(
            "run_evals", "--client", "fake", "--out", str(tmp_path / "out"), "--min-accuracy", "0.5"
        )
    data = json.loads((tmp_path / "out" / "report.json").read_text())
    first, second = data["results"]
    assert first["outcome"] == "failed" and first["attempts"] == 3
    assert first["models"][-1] == "gpt-5.5"
    assert "count: expected 2, found 1" in first["failures"]
    assert len(second["failures"]) == 11
    assert "FAIL" in (tmp_path / "out" / "report.md").read_text()


def test_the_runner_refuses_unknown_cases_and_missing_keys(settings: Any) -> None:
    with pytest.raises(CommandError, match="No case"):
        call_command("run_evals", "--case", "nope")
    settings.LLM_API_KEY = ""
    with pytest.raises(CommandError, match="Unknown vendor"):
        call_command("run_evals", "--client", "live", "--vendor", "fake")


@pytest.mark.django_db
def test_a_live_run_needs_a_key(settings: Any) -> None:
    settings.LLM_API_KEY = ""
    with pytest.raises(CommandError, match="No API key"):
        call_command("run_evals", "--client", "live", "--vendor", "openai")


def test_a_missing_recording_is_an_error(evals_dir: Path) -> None:
    (evals_dir / "cases.json").write_text(
        json.dumps(
            [{"name": "x", "document": "documents/galley.json", "message": "m", "expect": []}]
        )
    )
    with pytest.raises(CommandError, match="No recording"):
        call_command("run_evals")


def test_cost_needs_a_price_for_every_model() -> None:
    calls = [
        Call(
            "gpt-5.4-mini", Usage(input_tokens=2_000_000, cached_tokens=1_000_000, output_tokens=0)
        )
    ]
    assert cost_usd(calls, settings.LLM_PRICES) == pytest.approx(0.75 + 0.075)
    assert cost_usd([Call("unknown", Usage())], settings.LLM_PRICES) is None

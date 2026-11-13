"""The photo eval runner, on the recorded answers."""

import json
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command

from llm.client import PhotoResponse
from llm.fake import FakeClient
from photos.evals import load_set, markdown, report, run_photo

PHOTOS = Path(settings.EVALS_DIR) / "photos"


def test_every_photo_has_a_source_and_a_recording() -> None:
    sources = (PHOTOS / "SOURCES.md").read_text("utf-8")
    photos = load_set(PHOTOS)
    assert len(photos) >= 12
    for name, _, _ in photos:
        assert f"`{name}.jpg`" in sources
        assert (PHOTOS / "recordings" / "fake" / f"{name}.json").exists()


def test_the_fake_run_writes_a_report(tmp_path: Path) -> None:
    call_command(
        "run_photo_evals", "--client", "fake", "--out", str(tmp_path), "--min-schema-valid", "1"
    )
    data = json.loads((tmp_path / "report.json").read_text())
    assert data["photos"] >= 12
    assert data["schema_valid_rate"] == 1
    assert data["schema_valid_first_rate"] < 1
    assert 0 < data["shape_accuracy"] < 1
    assert data["openings"]["recall"] < 1 and data["items"]["precision"] == 1
    assert data["cost_per_photo_usd"] > 0
    assert "| Photo | Valid |" in (tmp_path / "report.md").read_text()


def test_a_photo_is_scored_against_its_ground_truth() -> None:
    name, image, truth = load_set(PHOTOS, ["l-shape-fridge"])[0]
    answer = {
        "shape": "l-shape",
        "ceilingHeightIn": None,
        "walls": [
            {"label": "x", "lengthIn": None, "visible": True, "confidence": "low"},
            {"label": "y", "lengthIn": None, "visible": True, "confidence": "low"},
        ],
        "openings": [
            {
                "wall": "y",
                "kind": "window",
                "offsetIn": None,
                "widthIn": None,
                "heightIn": None,
                "sillIn": None,
                "confidence": "low",
            },
            {
                "wall": "x",
                "kind": "door",
                "offsetIn": None,
                "widthIn": None,
                "heightIn": None,
                "sillIn": None,
                "confidence": "low",
            },
        ],
        "items": [
            {
                "wall": "x",
                "category": "fridge",
                "offsetIn": None,
                "widthIn": None,
                "confidence": "low",
            }
        ],
        "notes": "",
    }
    client = FakeClient(
        photo_responses=[PhotoResponse(text=json.dumps(answer), stop_reason="completed")]
    )
    result = run_photo(name, image, truth, client, "m", "e")
    assert result.shape_correct
    assert result.openings == (1, 2, 1)
    assert result.items == (1, 1, 7)


def test_a_photo_that_never_matches_the_schema_scores_nothing() -> None:
    name, image, truth = load_set(PHOTOS, ["galley-basic"])[0]
    client = FakeClient(photo_responses=[PhotoResponse(text="no", stop_reason="completed")] * 3)
    result = run_photo(name, image, truth, client, "m", "e")
    assert not result.schema_valid and not result.shape_correct
    assert [call.model for call in result.calls] == ["m", "m", "e"]
    data = report(
        [result], {"client": "fake", "vendor": "fake", "models": {"vision": "m", "escalation": "e"}}
    )
    assert data["openings"]["precision"] is None
    assert data["cost_usd"] is None
    assert "n/a" in markdown(data)


@pytest.mark.django_db
def test_the_runner_refuses_unknown_photos_vendors_and_a_missing_key() -> None:
    with pytest.raises(CommandError, match="No photo"):
        call_command("run_photo_evals", "--photo", "nope")
    with pytest.raises(CommandError, match="Unknown vendor"):
        call_command("run_photo_evals", "--client", "live", "--vendor", "fake")
    with pytest.raises(CommandError, match="No API key"):
        call_command("run_photo_evals", "--client", "live", "--vendor", "openai")

import json
from pathlib import Path

import pytest
from django.conf import settings

from quotes.math import apply_bps, compute_quote, divide_half_up, line_total_cents

# The same file as packages/core/src/bom/quote.test.ts reads.
VECTORS = json.loads(
    (Path(settings.REPO_DIR) / "packages/core/test-vectors/quote.json").read_text(encoding="utf-8")
)["cases"]


def test_the_vectors_are_there() -> None:
    assert len(VECTORS) >= 8


@pytest.mark.parametrize("case", VECTORS, ids=[case["name"] for case in VECTORS])
def test_shared_vectors(case: dict) -> None:
    for line in case["lines"]:
        expected = line["lineTotalCents"]
        assert line_total_cents(line["quantity"], line["unit"], line["unitPriceCents"]) == expected
    assert compute_quote(case["lines"], case["settings"]) == case["totals"]


def test_half_rounds_up_and_less_rounds_down() -> None:
    assert divide_half_up(1, 2) == 1
    assert divide_half_up(49, 100) == 0
    assert divide_half_up(50, 100) == 1
    assert divide_half_up(150, 100) == 2
    assert apply_bps(5, 1000) == 1
    assert apply_bps(4, 1000) == 0

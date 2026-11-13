"""Quote arithmetic: a port of `packages/core/src/bom/` (money.ts, quote.ts, bom.ts).

The server does not price anything. It checks that the numbers of a quote it is asked to
store follow from each other. Both implementations are tested against
`packages/core/test-vectors/quote.json`, so they cannot drift apart.

Money is integer cents and rates are integer basis points. Python integers are exact.
"""

from typing import Any

BPS = 10000
# A quantity in square feet is stored in hundredths.
SQFT_SCALE = 100

TOTAL_KEYS = (
    "subtotalCents",
    "markupCents",
    "discountCents",
    "taxableCents",
    "taxCents",
    "totalCents",
)


def divide_half_up(numerator: int, denominator: int) -> int:
    """`numerator / denominator` rounded half up, for two non-negative integers."""
    return (2 * numerator + denominator) // (2 * denominator)


def apply_bps(cents: int, bps: int) -> int:
    return divide_half_up(cents * bps, BPS)


# One inch is 16 sixteenths. A price per inch of width is per 16 units of width.
IN = 16
DEFAULT_MULTIPLIER_BPS = BPS


def _as_text(value: Any) -> str:
    """How JavaScript's `String(value)` spells an option value, which keys `optionCents`."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def unit_price_cents(
    price: dict[str, Any], width: int, options: dict[str, Any], multiplier_bps: int
) -> int:
    """The price of one cabinet: base, plus per inch of width, plus its options, times a finish.

    The sum is kept in sixteenths of a cent so a filler a fraction of an inch wide is exact,
    and rounded half up once.
    """
    option_cents = price.get("optionCents") or {}
    options_total = sum(
        option_cents.get(f"{key}={_as_text(value)}", 0) for key, value in options.items()
    )
    sixteenths = (price["baseCents"] + options_total) * IN + price["perInchWidthCents"] * width
    return divide_half_up(sixteenths * multiplier_bps, IN * BPS)


def line_total_cents(quantity: int, unit: str, unit_price_cents: int) -> int:
    """Pieces times the unit price, or hundredths of a square foot times the price of one."""
    if unit == "each":
        return quantity * unit_price_cents
    return divide_half_up(quantity * unit_price_cents, SQFT_SCALE)


def compute_quote(lines: list[dict[str, Any]], settings: dict[str, Any]) -> dict[str, int]:
    """Subtotal, plus markup, minus discount on that sum, then tax on what is left."""
    subtotal = sum(line["lineTotalCents"] for line in lines)
    markup = apply_bps(subtotal, settings["markupBps"])
    discount = apply_bps(subtotal + markup, settings["discountBps"])
    taxable = subtotal + markup - discount
    tax = apply_bps(taxable, settings["taxBps"])
    return {
        "subtotalCents": subtotal,
        "markupCents": markup,
        "discountCents": discount,
        "taxableCents": taxable,
        "taxCents": tax,
        "totalCents": taxable + tax,
    }

import base64
import binascii
from typing import Any

from rest_framework import serializers, status
from rest_framework.exceptions import APIException

from controlpanel import catalogs

from .math import (
    DEFAULT_MULTIPLIER_BPS,
    TOTAL_KEYS,
    compute_quote,
    line_total_cents,
    unit_price_cents,
)
from .models import Quote

MAX_LINES = 500
MAX_ELEVATIONS = 24
MAX_DRAWING_BYTES = 1_500_000
MAX_RATE_BPS = 100_000
MAX_DISCOUNT_BPS = 10_000
# Far above any real quote, and safely inside what a JavaScript number holds exactly.
MAX_CENTS = 10**12
MAX_QUANTITY = 10**7
PNG_PREFIX = "data:image/png;base64,"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_RGB = b"\x02"
# The catalog id of a countertop line, as core's bill of materials names it.
COUNTERTOP_CATALOG_ID = "countertop"


class StrictIntegerField(serializers.IntegerField):
    """A JSON integer only: no string, float or boolean is turned into one."""

    def to_internal_value(self, data: Any) -> int:
        if isinstance(data, bool) or not isinstance(data, int):
            self.fail("invalid")
        return super().to_internal_value(data)


class StrictCharField(serializers.CharField):
    """A JSON string only: a number is not turned into one."""

    def to_internal_value(self, data: Any) -> str:
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class InconsistentQuote(APIException):
    """The numbers are well-formed but do not follow from each other."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "The quote's numbers do not add up."
    default_code = "inconsistent_quote"

    def __init__(self, errors: list[dict[str, str]]) -> None:
        super().__init__()
        self.errors = errors


class SettingsSerializer(serializers.Serializer):
    markupBps = StrictIntegerField(min_value=0, max_value=MAX_RATE_BPS)
    discountBps = StrictIntegerField(min_value=0, max_value=MAX_DISCOUNT_BPS)
    taxBps = StrictIntegerField(min_value=0, max_value=MAX_RATE_BPS)
    currency = serializers.ChoiceField(choices=["USD"])


class LineSerializer(serializers.Serializer):
    """One `BomLine` of core, plus the finish by name so the PDF needs no catalog."""

    key = StrictCharField(max_length=1000)
    catalogId = StrictCharField(max_length=200)
    description = StrictCharField(max_length=500)
    width = StrictIntegerField(min_value=1)
    height = StrictIntegerField(min_value=1)
    depth = StrictIntegerField(min_value=1)
    finishId = StrictCharField(max_length=200, allow_null=True)
    finishName = StrictCharField(max_length=200, allow_blank=True)
    options = serializers.DictField()
    quantity = StrictIntegerField(min_value=0, max_value=MAX_QUANTITY)
    unit = serializers.ChoiceField(choices=["each", "sqft"])
    unitPriceCents = StrictIntegerField(min_value=0, max_value=MAX_CENTS)
    lineTotalCents = StrictIntegerField(min_value=0, max_value=MAX_CENTS)
    itemIds = serializers.ListField(child=StrictCharField(max_length=36), max_length=5000)

    def validate_options(self, value: dict[str, Any]) -> dict[str, Any]:
        for option in value.values():
            if not isinstance(option, str | int | float | bool):
                raise serializers.ValidationError("An option is a string, a number or a boolean.")
        return value


class TotalsSerializer(serializers.Serializer):
    subtotalCents = StrictIntegerField(min_value=0)
    markupCents = StrictIntegerField(min_value=0)
    discountCents = StrictIntegerField(min_value=0)
    taxableCents = StrictIntegerField(min_value=0)
    taxCents = StrictIntegerField(min_value=0)
    totalCents = StrictIntegerField(min_value=0)


def _check_png(value: str) -> str:
    """A PNG as a data URL, of at most 1.5 MB once decoded."""
    if not value.startswith(PNG_PREFIX):
        raise serializers.ValidationError("A drawing is a PNG data URL.")
    encoded = value[len(PNG_PREFIX) :]
    # Four characters of base64 are three bytes, so this bounds the work before decoding.
    if len(encoded) > MAX_DRAWING_BYTES * 4 // 3 + 4:
        raise serializers.ValidationError("A drawing is larger than 1.5 MB.")
    try:
        image = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise serializers.ValidationError("A drawing is not valid base64.") from error
    if len(image) > MAX_DRAWING_BYTES:
        raise serializers.ValidationError("A drawing is larger than 1.5 MB.")
    if not image.startswith(PNG_SIGNATURE):
        raise serializers.ValidationError("A drawing is not a PNG image.")
    # The colour type in the IHDR chunk, which comes first. A PDF embeds an alpha channel
    # asynchronously, so only an opaque RGB image renders the same PDF every time.
    if image[12:16] != b"IHDR" or image[25:26] != PNG_RGB:
        raise serializers.ValidationError("A drawing is an RGB PNG without an alpha channel.")
    return value


class ElevationSerializer(serializers.Serializer):
    wallId = StrictCharField(max_length=36)
    # The wall's letter: A, B, C.
    label = StrictCharField(max_length=20)
    image = StrictCharField(validators=[_check_png])


class DrawingsSerializer(serializers.Serializer):
    plan = StrictCharField(validators=[_check_png])
    elevations = ElevationSerializer(many=True, max_length=MAX_ELEVATIONS)


def _price_errors(catalog_version: str, lines: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Each line's unit price, checked against the catalog version the quote names.

    The browser prices with the catalog it loaded; the server prices nothing, but it knows
    that version's prices, so a line that does not follow from them is refused.
    """
    catalog = catalogs.catalog_for_version(catalog_version)
    if catalog is None:
        return [
            {
                "path": "catalog_version",
                "message": f'There is no catalog version "{catalog_version}".',
            }
        ]
    entries = {entry["id"]: entry for entry in catalog["entries"]}
    finishes = {finish["id"]: finish for finish in catalog["finishes"]}
    errors = []
    for index, line in enumerate(lines):
        finish = finishes.get(line["finishId"] or "")
        if line["catalogId"] == COUNTERTOP_CATALOG_ID:
            expected = (finish or {}).get("pricePerSqftCents", 0)
        else:
            entry = entries.get(line["catalogId"])
            multiplier = (finish or {}).get("multiplierBps", DEFAULT_MULTIPLIER_BPS)
            expected = (
                unit_price_cents(entry["price"], line["width"], line["options"], multiplier)
                if entry
                else 0
            )
        if line["unitPriceCents"] != expected:
            errors.append(
                {
                    "path": f"lines[{index}].unitPriceCents",
                    "message": f"Expected {expected} from {catalog_version}'s prices.",
                }
            )
    return errors


class QuoteCreateSerializer(serializers.Serializer):
    # The draft revision the lines were computed from. The quote is refused if the draft
    # on the server is at another one, so it always matches the version it points to.
    draft_revision = StrictIntegerField(min_value=1)
    customer_name = StrictCharField(max_length=200)
    customer_email = serializers.EmailField(allow_blank=True, default="")
    customer_address = StrictCharField(max_length=1000, allow_blank=True, default="")
    notes = StrictCharField(max_length=5000, allow_blank=True, default="")
    catalog_version = StrictCharField(max_length=50)
    settings = SettingsSerializer()
    lines = LineSerializer(many=True, max_length=MAX_LINES)
    totals = TotalsSerializer()
    drawings = DrawingsSerializer()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        errors = _price_errors(attrs["catalog_version"], attrs["lines"])
        for index, line in enumerate(attrs["lines"]):
            expected = line_total_cents(line["quantity"], line["unit"], line["unitPriceCents"])
            if line["lineTotalCents"] != expected:
                errors.append(
                    {
                        "path": f"lines[{index}].lineTotalCents",
                        "message": f"Expected {expected} from the quantity and the unit price.",
                    }
                )
        expected_totals = compute_quote(attrs["lines"], attrs["settings"])
        for key in TOTAL_KEYS:
            if attrs["totals"][key] != expected_totals[key]:
                errors.append(
                    {
                        "path": f"totals.{key}",
                        "message": f"Expected {expected_totals[key]} from the lines and settings.",
                    }
                )
        if errors:
            raise InconsistentQuote(errors)
        return attrs


class QuoteSummarySerializer(serializers.ModelSerializer):
    """A quote in a list, without its lines and drawings."""

    design_version = serializers.IntegerField(source="design_version.number", read_only=True)
    total_cents = serializers.SerializerMethodField()

    class Meta:
        model = Quote
        fields = ("id", "number", "customer_name", "total_cents", "design_version", "created_at")
        read_only_fields = fields

    def get_total_cents(self, quote: Quote) -> int:
        return quote.totals["totalCents"]


class QuoteSerializer(serializers.ModelSerializer):
    """Everything the PDF is rendered from."""

    design = serializers.UUIDField(source="design_version.design_id", read_only=True)
    design_name = serializers.CharField(source="design_version.design.name", read_only=True)
    design_version = serializers.IntegerField(source="design_version.number", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    settings = SettingsSerializer(read_only=True)
    lines = LineSerializer(many=True, read_only=True)
    totals = TotalsSerializer(read_only=True)
    drawings = DrawingsSerializer(read_only=True)

    class Meta:
        model = Quote
        fields = (
            "id",
            "number",
            "project_name",
            "design",
            "design_name",
            "design_version",
            "customer_name",
            "customer_email",
            "customer_address",
            "notes",
            "catalog_version",
            "settings",
            "lines",
            "totals",
            "drawings",
            "created_at",
        )
        read_only_fields = fields


class InconsistentQuoteSerializer(serializers.Serializer):
    """The body of a 422."""

    detail = serializers.CharField()
    errors = serializers.ListField(child=serializers.DictField(child=serializers.CharField()))


class StaleDraftSerializer(serializers.Serializer):
    """The body of a 409."""

    detail = serializers.CharField()
    draft_revision = serializers.IntegerField()

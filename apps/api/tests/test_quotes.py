import base64
import copy
import threading
import uuid
from typing import Any

import pytest
from django.db import connection
from rest_framework.test import APIClient

from accounts.models import User
from projects.models import Design, DesignVersion, Project
from quotes.models import Quote
from quotes.serializers import MAX_DRAWING_BYTES

from .conftest import make_design


def png_bytes(size: int = 64, color_type: int = 2) -> bytes:
    """The start of a PNG: the signature and an IHDR chunk, padded to `size` bytes."""
    head = (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0dIHDR"
        + b"\x00\x00\x00\x02\x00\x00\x00\x02\x08"
        + bytes([color_type])
        + b"\x00\x00\x00"
    )
    return head + b"\x00" * (size - len(head))


def png_url(image: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(image).decode()


PNG = png_url(png_bytes())


def line(**overrides: Any) -> dict[str, Any]:
    return {
        "key": "base.standard|base|480|552|384|cabinet.white|{}",
        "catalogId": "base.standard",
        "description": "Base cabinet, 2 doors, top drawer, hinge left",
        "width": 480,
        "height": 552,
        "depth": 384,
        "finishId": "cabinet.white",
        "finishName": "White",
        "options": {"doors": 2, "hinge": "left", "topDrawer": True},
        "quantity": 2,
        "unit": "each",
        "unitPriceCents": 32500,
        "lineTotalCents": 65000,
        "itemIds": ["item-0001", "item-0002"],
        **overrides,
    }


COUNTERTOP = line(
    key="countertop|countertop.white",
    catalogId="countertop",
    description="Countertop, White stone",
    finishId="countertop.white",
    finishName="White stone",
    options={},
    quantity=1727,
    unit="sqft",
    unitPriceCents=6500,
    lineTotalCents=112255,
    itemIds=["top-0001"],
)


def payload(**overrides: Any) -> dict[str, Any]:
    """A consistent quote: 65000 + 112255, 20% markup, 5% discount, 8.25% tax."""
    body: dict[str, Any] = {
        "draft_revision": 1,
        "customer_name": "Grace Hopper",
        "customer_email": "grace@example.com",
        "customer_address": "1 Navy Way\nArlington, VA",
        "notes": "Deliver to the side door.",
        "catalog_version": "seed-1",
        "settings": {"markupBps": 2000, "discountBps": 500, "taxBps": 825, "currency": "USD"},
        "lines": [line(), COUNTERTOP],
        "totals": {
            "subtotalCents": 177255,
            "markupCents": 35451,
            "discountCents": 10635,
            "taxableCents": 202071,
            "taxCents": 16671,
            "totalCents": 218742,
        },
        "drawings": {
            "plan": PNG,
            "elevations": [{"wallId": "wall-north", "label": "A", "image": PNG}],
        },
    }
    body.update(overrides)
    return copy.deepcopy(body)


def url(design: Design) -> str:
    return f"/api/designs/{design.id}/quotes/"


def test_create_snapshots_the_draft_and_stores_the_quote(
    client: APIClient, design: Design, user: User
) -> None:
    response = client.post(url(design), payload())

    assert response.status_code == 201, response.json()
    body = response.json()
    quote = Quote.objects.get(pk=body["id"])
    version = DesignVersion.objects.get(design=design)
    # The quote points at a new, immutable version made from the draft.
    assert quote.design_version == version
    assert (version.number, version.label, version.document) == (
        1,
        "Quote 1",
        design.draft_document,
    )
    assert (quote.number, quote.project, quote.created_by) == (1, design.project, user)
    assert body == {
        "id": str(quote.id),
        "number": 1,
        "project_name": "Lake house",
        "design": str(design.id),
        "design_name": "Kitchen",
        "design_version": 1,
        "customer_name": "Grace Hopper",
        "customer_email": "grace@example.com",
        "customer_address": "1 Navy Way\nArlington, VA",
        "notes": "Deliver to the side door.",
        "catalog_version": "seed-1",
        "settings": payload()["settings"],
        "lines": payload()["lines"],
        "totals": payload()["totals"],
        "drawings": payload()["drawings"],
        "created_at": body["created_at"],
    }
    # Creating a quote leaves the draft alone.
    design.refresh_from_db()
    assert design.draft_revision == 1


def test_read_gives_back_what_was_stored(client: APIClient, design: Design) -> None:
    created = client.post(url(design), payload()).json()

    response = client.get(f"/api/quotes/{created['id']}/")

    assert response.status_code == 200
    assert response.json() == created


def test_optional_fields_may_be_left_out(client: APIClient, design: Design) -> None:
    body = payload()
    for field in ("customer_email", "customer_address", "notes"):
        del body[field]
    body["drawings"]["elevations"] = []

    response = client.post(url(design), body)

    assert response.status_code == 201
    assert response.json()["customer_email"] == ""
    assert response.json()["notes"] == ""


def test_list_is_newest_first_without_lines_or_drawings(
    client: APIClient, design: Design, project: Project
) -> None:
    other_design = make_design(project, "Pantry")
    client.post(url(design), payload(customer_name="First"))
    client.post(url(other_design), payload(customer_name="Elsewhere"))
    client.post(url(design), payload(customer_name="Second"))

    response = client.get(url(design))

    assert response.status_code == 200
    rows = response.json()
    # Numbers run through the project, so the other design's quote took number 2.
    assert [(row["number"], row["customer_name"]) for row in rows] == [(3, "Second"), (1, "First")]
    assert rows[0] == {
        "id": rows[0]["id"],
        "number": 3,
        "customer_name": "Second",
        "total_cents": 218742,
        "design_version": 2,
        "created_at": rows[0]["created_at"],
    }


def test_delete_removes_the_quote_but_not_the_version_and_the_number_is_not_reused(
    client: APIClient, design: Design
) -> None:
    first = client.post(url(design), payload()).json()

    assert client.delete(f"/api/quotes/{first['id']}/").status_code == 204

    assert not Quote.objects.exists()
    assert DesignVersion.objects.filter(design=design).count() == 1
    assert client.get(f"/api/quotes/{first['id']}/").status_code == 404
    assert client.post(url(design), payload()).json()["number"] == 2


def test_quotes_cannot_be_updated(client: APIClient, design: Design) -> None:
    created = client.post(url(design), payload()).json()
    detail = f"/api/quotes/{created['id']}/"

    for method in (client.put, client.patch, client.post):
        assert method(detail, payload(customer_name="Changed")).status_code == 405
    assert client.put(url(design), payload()).status_code == 405
    assert Quote.objects.get().customer_name == "Grace Hopper"


def test_a_later_autosave_does_not_change_what_the_quote_points_at(
    client: APIClient, design: Design
) -> None:
    client.post(url(design), payload())
    snapshot = Quote.objects.get().design_version.document

    changed = {**design.draft_document, "name": "Changed afterwards"}
    saved = client.put(
        f"/api/designs/{design.id}/draft/", {"document": changed, "base_revision": 1}
    )

    assert saved.status_code == 200
    assert Quote.objects.get().design_version.document == snapshot
    assert snapshot["name"] == "Sample kitchen"


def test_a_quote_computed_from_another_revision_is_refused(
    client: APIClient, design: Design
) -> None:
    response = client.post(url(design), payload(draft_revision=2))

    assert response.status_code == 409
    assert response.json()["draft_revision"] == 1
    assert not Quote.objects.exists()
    assert not DesignVersion.objects.exists()
    design.project.refresh_from_db()
    assert design.project.last_quote_number == 0


def _tampered(path: list[Any], value: Any) -> dict[str, Any]:
    body = payload()
    target: Any = body
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return body


@pytest.mark.parametrize(
    ("path", "value", "error_path"),
    [
        (["totals", "totalCents"], 218741, "totals.totalCents"),
        (["totals", "taxCents"], 0, "totals.taxCents"),
        (["totals", "subtotalCents"], 1, "totals.subtotalCents"),
        (["lines", 0, "lineTotalCents"], 64999, "lines[0].lineTotalCents"),
        (["lines", 0, "quantity"], 3, "lines[0].lineTotalCents"),
        (["lines", 1, "lineTotalCents"], 112254, "lines[1].lineTotalCents"),
        (["settings", "discountBps"], 600, "totals.discountCents"),
    ],
)
def test_tampered_numbers_are_rejected_with_422_and_nothing_is_stored(
    client: APIClient, design: Design, path: list, value: Any, error_path: str
) -> None:
    response = client.post(url(design), _tampered(path, value))

    assert response.status_code == 422, response.json()
    assert response.json()["detail"] == "The quote's numbers do not add up."
    assert error_path in [error["path"] for error in response.json()["errors"]]
    assert not Quote.objects.exists()
    assert not DesignVersion.objects.exists()


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (["customer_name"], ""),
        (["customer_email"], "not-an-email"),
        (["catalog_version"], ""),
        (["draft_revision"], 0),
        (["settings", "markupBps"], -1),
        (["settings", "discountBps"], 10001),
        (["settings", "taxBps"], 8.25),
        (["settings", "currency"], "EUR"),
        (["lines", 0, "unit"], "box"),
        (["lines", 0, "unitPriceCents"], -1),
        (["lines", 0, "unitPriceCents"], 325.5),
        (["lines", 0, "quantity"], -2),
        (["lines", 0, "width"], 0),
        (["lines", 0, "options"], {"doors": [2]}),
        (["lines", 0, "finishId"], 7),
        (["lines"], "none"),
        (["totals", "totalCents"], "218742.0"),
        (["totals"], {}),
        (["drawings", "plan"], "data:image/jpeg;base64,AAAA"),
        (["drawings", "plan"], "data:image/png;base64,***"),
        (["drawings", "plan"], "data:image/png;base64," + base64.b64encode(b"GIF89a").decode()),
        (["drawings", "elevations", 0, "image"], "https://example.com/a.png"),
        (["drawings", "plan"], png_url(png_bytes(color_type=6))),
        (["drawings", "plan"], png_url(png_bytes(color_type=4))),
        (["drawings", "elevations"], [{"wallId": "w", "label": "A"}]),
        (["drawings"], {}),
    ],
)
def test_malformed_quotes_are_rejected_with_400(
    client: APIClient, design: Design, path: list, value: Any
) -> None:
    response = client.post(url(design), _tampered(path, value))

    assert response.status_code == 400, response.json()
    assert not Quote.objects.exists()
    assert not DesignVersion.objects.exists()


def test_a_missing_field_is_a_400(client: APIClient, design: Design) -> None:
    for field in ("customer_name", "settings", "lines", "totals", "drawings", "draft_revision"):
        body = payload()
        del body[field]
        assert client.post(url(design), body).status_code == 400, field


def _png_of(size: int) -> str:
    return png_url(png_bytes(size))


def test_a_drawing_is_capped_at_one_and_a_half_megabytes(client: APIClient, design: Design) -> None:
    at_the_cap = _tampered(["drawings", "plan"], _png_of(MAX_DRAWING_BYTES))
    over = _tampered(["drawings", "elevations", 0, "image"], _png_of(MAX_DRAWING_BYTES + 1))

    refused = client.post(url(design), over)
    assert refused.status_code == 400
    assert "larger than 1.5 MB" in str(refused.json())
    assert not Quote.objects.exists()

    # A body with a drawing at the cap is larger than the 2 MB of other requests.
    assert client.post(url(design), at_the_cap).status_code == 201


def test_a_quote_body_has_a_limit_of_its_own(client: APIClient, design: Design) -> None:
    body = payload()
    body["drawings"]["elevations"] = [
        {"wallId": f"wall-{i}", "label": "A", "image": _png_of(MAX_DRAWING_BYTES)} for i in range(7)
    ]

    response = client.post(url(design), body)

    assert response.status_code == 413
    assert response.json()["detail"] == "The request body is larger than 12 MB."


def test_no_lines_is_a_valid_empty_quote(client: APIClient, design: Design) -> None:
    zero = dict.fromkeys(payload()["totals"], 0)

    response = client.post(url(design), payload(lines=[], totals=zero))

    assert response.status_code == 201
    assert response.json()["totals"]["totalCents"] == 0


def test_unknown_design_or_quote_is_404(client: APIClient) -> None:
    assert client.get(f"/api/designs/{uuid.uuid4()}/quotes/").status_code == 404
    assert client.post(f"/api/designs/{uuid.uuid4()}/quotes/", payload()).status_code == 404
    assert client.get(f"/api/quotes/{uuid.uuid4()}/").status_code == 404
    assert client.delete(f"/api/quotes/{uuid.uuid4()}/").status_code == 404


def test_archiving_the_project_hides_its_quotes(client: APIClient, design: Design) -> None:
    created = client.post(url(design), payload()).json()

    client.delete(f"/api/projects/{design.project_id}/")

    assert client.get(f"/api/quotes/{created['id']}/").status_code == 404
    assert Quote.objects.count() == 1


def test_deleting_the_design_deletes_its_quotes(client: APIClient, design: Design) -> None:
    client.post(url(design), payload())

    client.delete(f"/api/designs/{design.id}/")

    assert not Quote.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_quote_numbers_are_sequential_under_concurrent_creates(user: User, design: Design) -> None:
    count = 5
    start = threading.Barrier(count)
    statuses: list[int] = []

    def create() -> None:
        try:
            api = APIClient()
            api.force_login(user)
            start.wait(timeout=10)
            statuses.append(api.post(url(design), payload()).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=create) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert statuses == [201] * count
    assert sorted(Quote.objects.values_list("number", flat=True)) == [1, 2, 3, 4, 5]
    versions = DesignVersion.objects.filter(design=design).values_list("number", flat=True)
    assert sorted(versions) == [1, 2, 3, 4, 5]
    assert Quote.objects.values("design_version").distinct().count() == count

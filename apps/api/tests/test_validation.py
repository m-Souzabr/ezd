import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from config.api import MAX_BODY_BYTES
from projects.models import Design

from .conftest import core_fixture

# The invalid fixtures of the core domain phase, and where each one is wrong.
INVALID_FIXTURES = {
    "dangling-wall-id": "items[2].placement.wallId",
    "duplicate-id": "items[1].id",
    "float-length": "items[0].width",
    "zero-length-wall": "room.walls[3].end",
}


def _save(client: APIClient, design: Design, document: object):
    return client.put(
        f"/api/designs/{design.id}/draft/", {"document": document, "base_revision": 1}
    )


def _assert_untouched(design: Design) -> None:
    before = design.draft_document
    design.refresh_from_db()
    assert (design.draft_document, design.draft_revision) == (before, 1)


@pytest.mark.parametrize(("name", "path"), INVALID_FIXTURES.items())
def test_invalid_core_fixtures_are_rejected_with_their_error_paths(
    client: APIClient, design: Design, name: str, path: str
) -> None:
    response = _save(client, design, core_fixture(name, str(design.id)))

    assert response.status_code == 422
    body = response.json()
    assert body["detail"] == "The document is not a valid design document."
    assert path in [error["path"] for error in body["errors"]]
    assert all(set(error) == {"path", "message"} for error in body["errors"])
    _assert_untouched(design)


def test_every_invalid_core_fixture_is_covered() -> None:
    from .conftest import FIXTURES

    names = {path.stem for path in FIXTURES.glob("*.json")}
    assert names == {"valid", *INVALID_FIXTURES}


@pytest.mark.parametrize("version", [0, 2, 99, "1", None, True, 1.5])
def test_an_unknown_schema_version_is_rejected(
    client: APIClient, design: Design, version: object
) -> None:
    document = {**core_fixture("valid", str(design.id)), "schemaVersion": version}

    response = _save(client, design, document)

    assert response.status_code == 422
    assert [error["path"] for error in response.json()["errors"]] == ["schemaVersion"]
    _assert_untouched(design)


def test_a_missing_schema_version_is_rejected(client: APIClient, design: Design) -> None:
    document = core_fixture("valid", str(design.id))
    del document["schemaVersion"]

    assert _save(client, design, document).status_code == 422
    _assert_untouched(design)


def test_the_document_id_must_be_the_design_id(client: APIClient, design: Design) -> None:
    response = _save(client, design, core_fixture("valid"))

    assert response.status_code == 422
    assert [error["path"] for error in response.json()["errors"]] == ["id"]
    _assert_untouched(design)


def test_unknown_fields_and_missing_fields_are_rejected(client: APIClient, design: Design) -> None:
    extra = {**core_fixture("valid", str(design.id)), "script": "alert(1)"}
    missing = core_fixture("valid", str(design.id))
    del missing["room"]

    assert _save(client, design, extra).status_code == 422
    assert _save(client, design, missing).status_code == 422
    _assert_untouched(design)


def test_an_oversized_body_is_a_413(client: APIClient, design: Design) -> None:
    document = core_fixture("valid", str(design.id))
    document["name"] = "x" * (MAX_BODY_BYTES + 1)

    response = _save(client, design, document)

    assert response.status_code == 413
    _assert_untouched(design)


def test_a_body_just_under_the_limit_is_read(client: APIClient, design: Design) -> None:
    # Not a valid document, but it gets as far as validation: the size is accepted.
    padding = "x" * (MAX_BODY_BYTES - 200)
    response = _save(client, design, {"schemaVersion": 1, "padding": padding})

    assert response.status_code == 422


def test_malformed_json_is_a_400(client: APIClient, design: Design) -> None:
    response = client.put(
        f"/api/designs/{design.id}/draft/", "{not json", content_type="application/json"
    )

    assert response.status_code == 400


@override_settings(EZD_CORE_CLI=["/nonexistent/ezd-core"])
def test_nothing_is_stored_when_core_cannot_be_run(client: APIClient, design: Design) -> None:
    response = _save(client, design, core_fixture("valid", str(design.id)))

    assert response.status_code == 503
    _assert_untouched(design)


@override_settings(EZD_CORE_CLI=["echo", "not json"])
def test_nothing_is_stored_when_core_answers_nonsense(client: APIClient, design: Design) -> None:
    assert _save(client, design, core_fixture("valid", str(design.id))).status_code == 503
    _assert_untouched(design)

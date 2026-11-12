import threading

import pytest
from django.db import connection
from rest_framework.test import APIClient

from accounts.models import User
from projects.models import Design

from .conftest import core_fixture


def _changed(design: Design, name: str = "Renamed in the editor") -> dict:
    return {**core_fixture("valid", str(design.id)), "name": name}


def test_autosave_with_the_current_revision_saves(client: APIClient, design: Design) -> None:
    document = _changed(design)

    response = client.put(
        f"/api/designs/{design.id}/draft/", {"document": document, "base_revision": 1}
    )

    assert response.status_code == 200
    assert response.json()["draft_revision"] == 2
    before = design.updated_at
    design.refresh_from_db()
    assert design.draft_document == document
    assert design.draft_revision == 2
    assert design.updated_at > before
    assert response.json()["updated_at"] == design.updated_at.isoformat().replace("+00:00", "Z")


def test_autosave_with_a_stale_revision_is_a_409_and_changes_nothing(
    client: APIClient, design: Design
) -> None:
    url = f"/api/designs/{design.id}/draft/"
    first = _changed(design, "First")
    assert client.put(url, {"document": first, "base_revision": 1}).status_code == 200
    design.refresh_from_db()

    response = client.put(url, {"document": _changed(design, "Stale"), "base_revision": 1})

    assert response.status_code == 409
    assert response.json() == {
        "detail": "The design was changed elsewhere since this revision.",
        "draft_revision": 2,
        "updated_at": design.updated_at.isoformat().replace("+00:00", "Z"),
    }
    updated_at = design.updated_at
    design.refresh_from_db()
    assert (design.draft_document, design.draft_revision) == (first, 2)
    assert design.updated_at == updated_at
    # A revision from the future is stale too.
    assert client.put(url, {"document": first, "base_revision": 7}).status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"base_revision": 1},
        {"document": {}, "base_revision": 0},
        {"document": {}, "base_revision": "one"},
        {"document": [], "base_revision": 1},
    ],
)
def test_autosave_needs_a_document_and_a_revision(
    client: APIClient, design: Design, body: dict
) -> None:
    response = client.put(f"/api/designs/{design.id}/draft/", body)

    assert response.status_code == 400
    design.refresh_from_db()
    assert design.draft_revision == 1


def test_autosave_is_put_only(client: APIClient, design: Design) -> None:
    url = f"/api/designs/{design.id}/draft/"
    assert client.get(url).status_code == 405
    assert client.post(url, {}).status_code == 405


@pytest.mark.django_db(transaction=True)
def test_two_concurrent_saves_from_the_same_base_produce_one_success(
    user: User, design: Design
) -> None:
    url = f"/api/designs/{design.id}/draft/"
    start = threading.Barrier(2)
    results: dict[str, int] = {}

    def save(name: str) -> None:
        try:
            api = APIClient()
            api.force_login(user)
            start.wait(timeout=10)
            response = api.put(url, {"document": _changed(design, name), "base_revision": 1})
            results[name] = response.status_code
        finally:
            connection.close()

    threads = [threading.Thread(target=save, args=(name,)) for name in ("left", "right")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(results.values()) == [200, 409]
    winner = next(name for name, status in results.items() if status == 200)
    design.refresh_from_db()
    assert design.draft_revision == 2
    assert design.draft_document["name"] == winner

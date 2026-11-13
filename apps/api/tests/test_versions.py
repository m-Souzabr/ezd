import json
import threading
import uuid

import pytest
from django.db import connection
from rest_framework.test import APIClient

from accounts.models import User
from projects.models import Design, DesignVersion

from .conftest import core_fixture


def _autosave(client: APIClient, design: Design, name: str, base: int) -> None:
    document = {**core_fixture("valid", str(design.id)), "name": name}
    response = client.put(
        f"/api/designs/{design.id}/draft/", {"document": document, "base_revision": base}
    )
    assert response.status_code == 200


def test_save_version_snapshots_the_current_draft(
    client: APIClient, design: Design, user: User
) -> None:
    url = f"/api/designs/{design.id}/versions/"

    first = client.post(url, {"label": "Before the island"})
    _autosave(client, design, "With an island", 1)
    second = client.post(url, {})

    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["number"] == 1
    assert first.json()["label"] == "Before the island"
    assert second.json()["number"] == 2
    assert second.json()["label"] == ""
    assert "document" not in first.json()
    one, two = DesignVersion.objects.filter(design=design).order_by("number")
    assert one.document["name"] == "Sample kitchen"
    assert two.document["name"] == "With an island"
    assert one.created_by == user
    # Saving a version leaves the draft alone.
    design.refresh_from_db()
    assert design.draft_revision == 2


def test_a_later_autosave_does_not_change_a_snapshot(client: APIClient, design: Design) -> None:
    client.post(f"/api/designs/{design.id}/versions/", {})
    snapshot = DesignVersion.objects.get(design=design).document

    _autosave(client, design, "Changed afterwards", 1)

    assert DesignVersion.objects.get(design=design).document == snapshot
    assert snapshot["name"] == "Sample kitchen"


def test_snapshots_cannot_be_changed_or_deleted_through_the_api(
    client: APIClient, design: Design, version: DesignVersion
) -> None:
    url = f"/api/designs/{design.id}/versions/1/"

    for method in (client.put, client.patch, client.delete, client.post):
        assert method(url, {"label": "Edited", "document": {}}).status_code == 405
    version.refresh_from_db()
    assert version.label == "First"


def test_list_versions_newest_first_without_documents(client: APIClient, design: Design) -> None:
    url = f"/api/designs/{design.id}/versions/"
    client.post(url, {"label": "one"})
    client.post(url, {"label": "two"})

    response = client.get(url)

    assert response.status_code == 200
    assert [(row["number"], row["label"]) for row in response.json()] == [(2, "two"), (1, "one")]
    assert set(response.json()[0]) == {"id", "number", "label", "schema_version", "created_at"}


def test_read_one_version_with_its_document(
    client: APIClient, design: Design, version: DesignVersion
) -> None:
    response = client.get(f"/api/designs/{design.id}/versions/1/")

    assert response.status_code == 200
    assert response.json()["document"] == version.document
    assert response.json()["label"] == "First"
    assert client.get(f"/api/designs/{design.id}/versions/2/").status_code == 404


def test_label_is_limited(client: APIClient, design: Design) -> None:
    response = client.post(f"/api/designs/{design.id}/versions/", {"label": "x" * 201})

    assert response.status_code == 400
    assert not DesignVersion.objects.exists()


def test_restore_copies_the_snapshot_into_the_draft_and_bumps_the_revision(
    client: APIClient, design: Design
) -> None:
    client.post(f"/api/designs/{design.id}/versions/", {})
    _autosave(client, design, "Changed afterwards", 1)

    response = client.post(f"/api/designs/{design.id}/versions/1/restore/")

    assert response.status_code == 200
    version = DesignVersion.objects.get(design=design)
    design.refresh_from_db()
    assert design.draft_revision == 3
    assert response.json()["draft_revision"] == 3
    assert response.json()["draft_document"] == version.document
    # Byte for byte: the stored JSON text of the two columns is the same.
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT d.draft_document::text, v.document::text "
            "FROM projects_design d JOIN projects_designversion v ON v.design_id = d.id "
            "WHERE d.id = %s",
            [design.id],
        )
        draft_text, snapshot_text = cursor.fetchone()
    assert draft_text == snapshot_text
    assert json.loads(draft_text)["name"] == "Sample kitchen"
    # The snapshot is still there, and an autosave from before the restore is now stale.
    assert DesignVersion.objects.filter(design=design).count() == 1
    stale = client.put(
        f"/api/designs/{design.id}/draft/",
        {"document": core_fixture("valid", str(design.id)), "base_revision": 2},
    )
    assert stale.status_code == 409


def test_restore_and_versions_of_unknown_things_are_404(client: APIClient, design: Design) -> None:
    assert client.post(f"/api/designs/{design.id}/versions/5/restore/").status_code == 404
    assert client.post(f"/api/designs/{uuid.uuid4()}/versions/1/restore/").status_code == 404
    assert client.get(f"/api/designs/{uuid.uuid4()}/versions/").status_code == 404
    assert client.post(f"/api/designs/{uuid.uuid4()}/versions/", {}).status_code == 404
    design.refresh_from_db()
    assert design.draft_revision == 1


@pytest.mark.django_db(transaction=True)
def test_snapshot_numbers_are_sequential_under_concurrent_creates(
    user: User, design: Design
) -> None:
    count = 6
    start = threading.Barrier(count)
    statuses: list[int] = []

    def snapshot() -> None:
        try:
            api = APIClient()
            api.force_login(user)
            start.wait(timeout=10)
            statuses.append(api.post(f"/api/designs/{design.id}/versions/", {}).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=snapshot) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert statuses == [201] * count
    numbers = DesignVersion.objects.filter(design=design).values_list("number", flat=True)
    assert sorted(numbers) == list(range(1, count + 1))

import pytest
from rest_framework.test import APIClient

from projects.documents import empty_document
from projects.models import Design, Project

from .conftest import core_fixture


def _valid_documents() -> dict[str, dict]:
    return {"valid": core_fixture("valid"), "empty": empty_document("placeholder-id", "Empty")}


@pytest.mark.parametrize("name", _valid_documents())
def test_a_document_comes_back_from_the_api_as_it_went_in(
    client: APIClient, project: Project, design: Design, name: str
) -> None:
    original = _valid_documents()[name]

    # As the initial document of a new design.
    created = client.post(f"/api/projects/{project.id}/designs/", {"document": original})
    assert created.status_code == 201
    new_id = created.json()["id"]
    assert client.get(f"/api/designs/{new_id}/").json()["draft_document"] == {
        **original,
        "id": new_id,
    }

    # Through autosave, a snapshot and a restore.
    document = {**original, "id": str(design.id)}
    saved = client.put(
        f"/api/designs/{design.id}/draft/", {"document": document, "base_revision": 1}
    )
    assert saved.status_code == 200
    assert client.get(f"/api/designs/{design.id}/").json()["draft_document"] == document
    client.post(f"/api/designs/{design.id}/versions/", {})
    assert client.get(f"/api/designs/{design.id}/versions/1/").json()["document"] == document
    restored = client.post(f"/api/designs/{design.id}/versions/1/restore/")
    assert restored.json()["draft_document"] == document

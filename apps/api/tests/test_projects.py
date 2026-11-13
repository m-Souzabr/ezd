import uuid

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from projects.models import Design, Project

from .conftest import core_fixture, make_design


def test_list_shows_own_projects_that_are_not_archived(
    client: APIClient, user: User, other_user: User, project: Project
) -> None:
    Project.objects.create(owner=other_user, name="Theirs")
    Project.objects.create(owner=user, name="Old", archived_at="2026-01-01T00:00:00Z")

    response = client.get("/api/projects/")

    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["Lake house"]
    assert set(response.json()[0]) == {"id", "name", "created_at", "updated_at"}


def test_create_project(client: APIClient, user: User) -> None:
    response = client.post("/api/projects/", {"name": "Cabin"})

    assert response.status_code == 201
    created = Project.objects.get(pk=response.json()["id"])
    assert (created.name, created.owner, created.archived_at) == ("Cabin", user, None)


@pytest.mark.parametrize("body", [{}, {"name": ""}, {"name": "x" * 201}])
def test_create_project_validates_the_name(client: APIClient, body: dict) -> None:
    assert client.post("/api/projects/", body).status_code == 400
    assert not Project.objects.exists()


def test_read_and_rename_project(client: APIClient, project: Project) -> None:
    url = f"/api/projects/{project.id}/"
    assert client.get(url).json()["name"] == "Lake house"

    response = client.patch(url, {"name": "Lake cabin"})

    assert response.status_code == 200
    project.refresh_from_db()
    assert project.name == "Lake cabin"
    assert client.patch(url, {"name": ""}).status_code == 400
    assert client.put(url, {"name": "Put"}).status_code == 405


def test_delete_archives_the_project_and_hides_its_designs(
    client: APIClient, project: Project, design: Design
) -> None:
    assert client.delete(f"/api/projects/{project.id}/").status_code == 204

    project.refresh_from_db()
    assert project.archived_at is not None
    assert Design.objects.filter(pk=design.pk).exists()
    assert client.get("/api/projects/").json() == []
    assert client.get(f"/api/projects/{project.id}/").status_code == 404
    assert client.get(f"/api/projects/{project.id}/designs/").status_code == 404
    assert client.get(f"/api/designs/{design.id}/").status_code == 404


def test_unknown_project_is_404(client: APIClient) -> None:
    assert client.get(f"/api/projects/{uuid.uuid4()}/").status_code == 404
    assert client.get(f"/api/projects/{uuid.uuid4()}/designs/").status_code == 404
    assert client.post(f"/api/projects/{uuid.uuid4()}/designs/", {}).status_code == 404


def test_list_designs_has_no_documents(client: APIClient, project: Project, design: Design) -> None:
    make_design(Project.objects.create(owner=project.owner, name="Other"), "Elsewhere")

    response = client.get(f"/api/projects/{project.id}/designs/")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": str(design.id),
            "project": str(project.id),
            "name": "Kitchen",
            "draft_revision": 1,
            "created_at": response.json()[0]["created_at"],
            "updated_at": response.json()[0]["updated_at"],
        }
    ]


def test_create_design_without_a_document_makes_an_empty_one(
    client: APIClient, project: Project
) -> None:
    response = client.post(f"/api/projects/{project.id}/designs/", {})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Untitled kitchen"
    assert body["draft_revision"] == 1
    assert body["schema_version"] == 1
    assert body["draft_document"] == {
        "schemaVersion": 1,
        "id": body["id"],
        "name": "Untitled kitchen",
        "room": {"ceilingHeight": 1536, "walls": [], "openings": []},
        "items": [],
        "countertops": [],
        "finishes": {},
    }
    assert Design.objects.get(pk=body["id"]).project == project


def test_create_design_from_a_document_gives_it_the_design_id(
    client: APIClient, project: Project
) -> None:
    document = core_fixture("valid")

    response = client.post(f"/api/projects/{project.id}/designs/", {"document": document})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Sample kitchen"
    assert body["draft_document"] == {**document, "id": body["id"]}

    named = client.post(
        f"/api/projects/{project.id}/designs/", {"document": document, "name": "Plan B"}
    )
    assert named.json()["name"] == "Plan B"


def test_create_design_rejects_an_invalid_document_and_stores_nothing(
    client: APIClient, project: Project
) -> None:
    response = client.post(
        f"/api/projects/{project.id}/designs/", {"document": core_fixture("duplicate-id")}
    )

    assert response.status_code == 422
    assert not Design.objects.exists()
    assert client.post(f"/api/projects/{project.id}/designs/", {"name": ""}).status_code == 400
    assert client.post(f"/api/projects/{project.id}/designs/", {"document": 3}).status_code == 400


def test_read_rename_and_delete_design(client: APIClient, design: Design) -> None:
    url = f"/api/designs/{design.id}/"

    body = client.get(url).json()
    assert body["draft_document"] == design.draft_document
    assert (body["draft_revision"], body["schema_version"]) == (1, 1)

    renamed = client.patch(url, {"name": "Galley", "draft_revision": 9, "draft_document": {}})
    assert renamed.status_code == 200
    design.refresh_from_db()
    # Only the name is writable here.
    assert (design.name, design.draft_revision) == ("Galley", 1)
    assert design.draft_document["id"] == str(design.id)
    assert client.patch(url, {"name": ""}).status_code == 400

    assert client.delete(url).status_code == 204
    assert not Design.objects.filter(pk=design.pk).exists()
    assert client.get(url).status_code == 404

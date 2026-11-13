"""Every list endpoint pages its rows and reads them in a fixed number of queries."""

from collections.abc import Callable
from typing import Any

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from photos.models import Photo, PhotoDraft
from projects.models import Design, DesignVersion, Project

from .conftest import make_design
from .test_photos import ROOM_DRAFT, jpeg, stored_photo
from .test_quotes import payload


def _queries(client: APIClient, url: str) -> int:
    with CaptureQueriesContext(connection) as captured:
        assert client.get(url).status_code == 200
    return len(captured)


def _add_projects(user: User, project: Project, n: int) -> None:
    for i in range(n):
        Project.objects.create(owner=user, name=f"P{i}")


def _add_designs(user: User, project: Project, n: int) -> None:
    for i in range(n):
        make_design(project, f"D{i}")


def _add_versions(user: User, project: Project, n: int) -> None:
    design = Design.objects.filter(project=project).first() or make_design(project)
    start = DesignVersion.objects.filter(design=design).count()
    for i in range(n):
        DesignVersion.objects.create(
            design=design,
            number=start + i + 1,
            document=design.draft_document,
            schema_version=1,
            created_by=user,
        )


def _add_photos(user: User, project: Project, n: int) -> None:
    for _ in range(n):
        photo = stored_photo(project, jpeg())
        PhotoDraft.objects.create(photo=photo, status=PhotoDraft.Status.READY, draft=ROOM_DRAFT)


def _add_quotes(client: APIClient, project: Project, n: int) -> None:
    design = Design.objects.filter(project=project).first() or make_design(project)
    for _ in range(n):
        revision = Design.objects.get(pk=design.pk).draft_revision
        body = payload(draft_revision=revision)
        assert client.post(f"/api/designs/{design.id}/quotes/", body).status_code == 201


LISTS: dict[str, tuple[Callable[[Project], str], Callable[..., None]]] = {
    "projects": (lambda project: "/api/projects/", _add_projects),
    "designs": (lambda project: f"/api/projects/{project.id}/designs/", _add_designs),
    "versions": (
        lambda project: (
            f"/api/designs/{Design.objects.filter(project=project).first().id}/versions/"
        ),
        _add_versions,
    ),
    "photos": (lambda project: f"/api/projects/{project.id}/photos/", _add_photos),
}


@pytest.mark.parametrize("name", LISTS)
def test_a_list_reads_its_rows_in_a_fixed_number_of_queries(
    client: APIClient, user: User, project: Project, name: str
) -> None:
    url_for, add = LISTS[name]
    make_design(project)
    add(user, project, 1)
    few = _queries(client, url_for(project))
    add(user, project, 6)
    assert _queries(client, url_for(project)) == few


def test_quotes_read_in_a_fixed_number_of_queries(client: APIClient, design: Design) -> None:
    _add_quotes(client, design.project, 1)
    url = f"/api/designs/{design.id}/quotes/"
    few = _queries(client, url)
    _add_quotes(client, design.project, 4)
    assert _queries(client, url) == few


def test_lists_are_paged_and_stay_arrays(client: APIClient, user: User, project: Project) -> None:
    _add_projects(user, project, 4)
    response = client.get("/api/projects/?limit=2&offset=1")
    body: Any = response.json()
    assert isinstance(body, list) and len(body) == 2
    assert response["X-Total-Count"] == "5"
    assert 'rel="next"' in response["Link"] and 'rel="prev"' in response["Link"]
    assert len(client.get("/api/projects/").json()) == 5
    assert client.get("/api/projects/?limit=100000").status_code == 200


def test_photos_list_does_not_grow_with_drafts(client: APIClient, project: Project) -> None:
    photo = stored_photo(project, jpeg())
    url = f"/api/projects/{project.id}/photos/"
    few = _queries(client, url)
    for _ in range(5):
        PhotoDraft.objects.create(photo=photo, status=PhotoDraft.Status.FAILED)
    assert _queries(client, url) == few
    assert Photo.objects.count() == 1

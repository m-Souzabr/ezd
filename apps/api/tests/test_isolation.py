"""No account can read or change what another account owns, on any route."""

import pytest
from django.urls import URLPattern, URLResolver, get_resolver, reverse
from rest_framework.test import APIClient

from projects.models import Design, DesignVersion, Project

from .conftest import core_fixture

# Routes that are not about an owned object.
PUBLIC = {
    "health",
    "auth-register",
    "auth-login",
    "auth-password-reset",
    "auth-password-reset-confirm",
}
OWN_SESSION = {"auth-logout", "auth-me"}
# Routes that list or create inside the signed-in account, with no object in the path.
COLLECTIONS = {"project-list"}

METHODS = ("get", "post", "put", "patch", "delete")


def _api_route_names(resolver: URLResolver | None = None, prefix: str = "") -> set[str]:
    names: set[str] = set()
    for entry in (resolver or get_resolver()).url_patterns:
        route = prefix + str(entry.pattern)
        if isinstance(entry, URLResolver):
            names |= _api_route_names(entry, route)
        elif isinstance(entry, URLPattern) and route.startswith("api/"):
            assert entry.name, f"The route {route} has no name"
            names.add(entry.name)
    return names


def _object_routes(design: Design, version: DesignVersion) -> dict[str, str]:
    """Every route with an owned object in its path, for the first user's objects."""
    project, number = design.project, version.number
    return {
        "project-detail": reverse("project-detail", args=[project.id]),
        "project-design-list": reverse("project-design-list", args=[project.id]),
        "design-detail": reverse("design-detail", args=[design.id]),
        "design-draft": reverse("design-draft", args=[design.id]),
        "design-version-list": reverse("design-version-list", args=[design.id]),
        "design-version-detail": reverse("design-version-detail", args=[design.id, number]),
        "design-version-restore": reverse("design-version-restore", args=[design.id, number]),
    }


def _bodies(design: Design) -> list[dict]:
    """Bodies that would be accepted from the owner, so a 404 is not hiding a 400."""
    document = {**core_fixture("valid", str(design.id)), "name": "Taken over"}
    return [{"name": "Taken over", "label": "Taken over", "document": document, "base_revision": 1}]


def test_every_api_route_is_accounted_for(design: Design, version: DesignVersion) -> None:
    covered = PUBLIC | OWN_SESSION | COLLECTIONS | set(_object_routes(design, version))
    assert _api_route_names() == covered


def test_another_user_gets_a_404_on_every_object_route(
    other_client: APIClient, client: APIClient, design: Design, version: DesignVersion
) -> None:
    before = (
        list(Project.objects.values()),
        list(Design.objects.values()),
        list(DesignVersion.objects.values()),
    )

    for name, url in _object_routes(design, version).items():
        for method in METHODS:
            for body in _bodies(design):
                response = getattr(other_client, method)(url, body)
                # 405 is for a method the route does not have at all, whoever asks.
                assert response.status_code in (404, 405), (name, method, response.status_code)
                if response.status_code == 405:
                    assert method.upper() not in client.options(url)["Allow"], (name, method)

    after = (
        list(Project.objects.values()),
        list(Design.objects.values()),
        list(DesignVersion.objects.values()),
    )
    assert after == before


def test_the_owner_is_not_a_404_on_the_same_routes(
    client: APIClient, design: Design, version: DesignVersion
) -> None:
    for name, url in _object_routes(design, version).items():
        if name == "design-version-restore":
            assert client.post(url).status_code == 200
        else:
            assert client.get(url).status_code in (200, 405), name


def test_lists_do_not_show_another_users_rows(
    other_client: APIClient, design: Design, version: DesignVersion
) -> None:
    assert other_client.get("/api/projects/").json() == []


@pytest.mark.django_db
def test_every_route_but_the_public_ones_needs_a_session(
    anonymous: APIClient, client: APIClient, design: Design, version: DesignVersion
) -> None:
    urls = {
        **_object_routes(design, version),
        **{name: reverse(name) for name in OWN_SESSION | COLLECTIONS},
    }
    for name, url in urls.items():
        for method in METHODS:
            response = getattr(anonymous, method)(url, {})
            assert response.status_code == 401, (name, method, response.status_code)
            assert response["WWW-Authenticate"] == "Session"

"""No account can read or change what another account owns, on any route."""

import pytest
from django.urls import URLPattern, URLResolver, get_resolver, reverse
from rest_framework.test import APIClient

from chat.models import Conversation, Message
from projects.models import Design, DesignVersion, Project
from quotes.models import Quote

from .conftest import core_fixture
from .test_quotes import payload

QUOTE = payload()

# Routes that are not about an owned object.
PUBLIC = {
    "health",
    "auth-register",
    "auth-login",
    "auth-password-reset",
    "auth-password-reset-confirm",
}
OWN_SESSION = {"auth-logout", "auth-me", "chat-usage"}
# Site-wide settings that only staff may read or change.
STAFF = {"llm-settings"}
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


def _quote(version: DesignVersion) -> Quote:
    quote, _ = Quote.objects.get_or_create(
        project=version.design.project,
        design_version=version,
        number=1,
        defaults={
            "customer_name": "Grace Hopper",
            "catalog_version": "seed-1",
            "settings": QUOTE["settings"],
            "lines": QUOTE["lines"],
            "totals": QUOTE["totals"],
            "drawings": QUOTE["drawings"],
            "created_by": version.created_by,
        },
    )
    return quote


def _chat_message(design: Design) -> Message:
    conversation, _ = Conversation.objects.get_or_create(design=design)
    user_message, _ = Message.objects.get_or_create(
        conversation=conversation, role=Message.Role.USER, defaults={"text": "Add a cabinet"}
    )
    message, _ = Message.objects.get_or_create(
        conversation=conversation,
        role=Message.Role.ASSISTANT,
        defaults={
            "parent": user_message,
            "status": Message.Status.PROPOSED,
            "tool_calls": [{"name": "generate_countertops", "arguments": {}}],
        },
    )
    return message


def _object_routes(design: Design, version: DesignVersion) -> dict[str, str]:
    """Every route with an owned object in its path, for the first user's objects."""
    project, number = design.project, version.number
    message = _chat_message(design)
    return {
        "design-chat": reverse("design-chat", args=[design.id]),
        "chat-message-retry": reverse("chat-message-retry", args=[message.id]),
        "chat-message-resolve": reverse("chat-message-resolve", args=[message.id]),
        "design-quote-list": reverse("design-quote-list", args=[design.id]),
        "quote-detail": reverse("quote-detail", args=[_quote(version).id]),
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
    return [
        {"name": "Taken over", "label": "Taken over", "document": document, "base_revision": 1},
        QUOTE,
        {
            "message": "Remove everything",
            "summary": "Wall A",
            "errors": ["x"],
            "status": "rejected",
        },
    ]


def _everything() -> tuple[list, ...]:
    return (
        list(Project.objects.values()),
        list(Design.objects.values()),
        list(DesignVersion.objects.values()),
        list(Quote.objects.values()),
        list(Conversation.objects.values()),
        list(Message.objects.values()),
    )


def test_every_api_route_is_accounted_for(design: Design, version: DesignVersion) -> None:
    covered = PUBLIC | OWN_SESSION | COLLECTIONS | STAFF | set(_object_routes(design, version))
    assert _api_route_names() == covered


def test_another_user_gets_a_404_on_every_object_route(
    other_client: APIClient, client: APIClient, design: Design, version: DesignVersion
) -> None:
    routes = _object_routes(design, version)
    before = _everything()

    for name, url in routes.items():
        for method in METHODS:
            for body in _bodies(design):
                response = getattr(other_client, method)(url, body)
                # 405 is for a method the route does not have at all, whoever asks.
                assert response.status_code in (404, 405), (name, method, response.status_code)
                if response.status_code == 405:
                    assert method.upper() not in client.options(url)["Allow"], (name, method)

    assert _everything() == before


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
        **{name: reverse(name) for name in OWN_SESSION | COLLECTIONS | STAFF},
    }
    for name, url in urls.items():
        for method in METHODS:
            response = getattr(anonymous, method)(url, {})
            assert response.status_code == 401, (name, method, response.status_code)
            assert response["WWW-Authenticate"] == "Session"

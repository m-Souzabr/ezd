"""The app configuration: the public read, the draft, publishing and rollback."""

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from controlpanel.models import AuditEntry, ConfigVersion

from .test_controlpanel import staff_with

DRAFT = "/api/admin/config/draft/"
PUBLISH = "/api/admin/config/publish/"
VERSIONS = "/api/admin/config/versions/"

HIDE_PROPERTIES = {"panels": {"properties": {"visible": False}}}


@pytest.fixture
def admin(db: None) -> APIClient:
    return staff_with("Administrator", "admin@example.com")


def save(api: APIClient, config: dict, revision: int = 0):
    return api.put(DRAFT, {"revision": revision, "app_config": config}, format="json")


def publish(api: APIClient, config: dict, note: str = "") -> dict:
    """Saves `config` as the draft and publishes it. Returns the published version."""
    draft = api.get(DRAFT).json()
    saved = save(api, config, draft["revision"])
    assert saved.status_code == 200, saved.content
    response = api.post(
        PUBLISH, {"revision": saved.json()["revision"], "note": note}, format="json"
    )
    assert response.status_code == 200, response.content
    return response.json()


# --- the public read --------------------------------------------------------------------


def test_with_no_row_the_api_serves_an_empty_config(db: None, anonymous: APIClient) -> None:
    body = anonymous.get("/api/config/").json()
    assert body["version"] is None
    assert body["config"]["features"] == {"assistant": True}


def test_the_public_read_needs_no_session_and_is_cached_briefly(
    admin: APIClient, anonymous: APIClient
) -> None:
    publish(admin, HIDE_PROPERTIES)
    response = anonymous.get("/api/config/")
    assert response.status_code == 200
    assert response.json()["config"]["panels"]["properties"]["visible"] is False
    assert response.json()["version"] == 1
    assert "max-age=" in response["Cache-Control"]
    assert "Cookie" not in response.get("Vary", "")


def test_a_draft_is_not_public(admin: APIClient, anonymous: APIClient) -> None:
    save(admin, HIDE_PROPERTIES)
    assert anonymous.get("/api/config/").json()["config"].get("panels") is None


def test_the_assistant_is_on_only_with_its_flag_and_a_key(
    admin: APIClient, anonymous: APIClient, settings
) -> None:
    settings.LLM_VENDOR = "openai"
    settings.LLM_API_KEY = ""
    assert anonymous.get("/api/config/").json()["config"]["features"]["assistant"] is False
    settings.LLM_API_KEY = "sk-test"
    assert anonymous.get("/api/config/").json()["config"]["features"]["assistant"] is True
    publish(admin, {"features": {"assistant": False}})
    assert anonymous.get("/api/config/").json()["config"]["features"]["assistant"] is False


# --- the draft --------------------------------------------------------------------------


def test_without_a_draft_the_editor_gets_the_published_config(admin: APIClient) -> None:
    assert admin.get(DRAFT).json() == {
        "revision": 0,
        "app_config": {},
        "rules_config": {},
        "quote_defaults": {},
        "based_on": None,
        "updated_at": None,
    }
    publish(admin, HIDE_PROPERTIES)
    draft = admin.get(DRAFT).json()
    assert draft["revision"] == 0
    assert draft["based_on"] == 1
    assert draft["app_config"]["panels"]["properties"]["visible"] is False


def test_saving_fills_the_defaults_and_bumps_the_revision(admin: APIClient) -> None:
    first = save(admin, HIDE_PROPERTIES).json()
    assert first["revision"] == 1
    assert first["app_config"]["features"]["quotes"] is True
    second = save(admin, {}, 1).json()
    assert second["revision"] == 2
    assert ConfigVersion.objects.filter(status="draft").count() == 1


def test_a_stale_save_is_a_409(admin: APIClient) -> None:
    save(admin, {})
    assert save(admin, {}, 1).status_code == 200
    stale = save(admin, HIDE_PROPERTIES, 1)
    assert stale.status_code == 409
    assert admin.get(DRAFT).json()["app_config"]["panels"]["properties"]["visible"] is True
    # A second first save, from a screen that loaded before any draft existed.
    assert save(admin, {}, 0).status_code == 409


@pytest.mark.parametrize(
    ("config", "path"),
    [
        ({"theme": {"plan": {"wall": "red"}}}, "theme.plan.wall"),
        ({"features": {"nope": True}}, "features"),
        ({"toolbar": {"tools": {"select": False}}}, "toolbar.tools.select"),
        ({"viewport": {"minScale": 99}}, "viewport.defaultScale"),
    ],
)
def test_an_invalid_config_is_a_422_with_core_paths(
    admin: APIClient, config: dict, path: str
) -> None:
    response = save(admin, config)
    assert response.status_code == 422
    assert path in [error["path"] for error in response.json()["errors"]]
    assert not ConfigVersion.objects.exists()


def test_a_config_that_is_not_an_object_is_refused(admin: APIClient) -> None:
    assert save(admin, ["x"]).status_code == 422  # type: ignore[arg-type]
    assert admin.put(DRAFT, {"revision": 0}, format="json").status_code == 400


# --- publishing and rollback ------------------------------------------------------------


def test_publishing_makes_an_immutable_numbered_version(admin: APIClient) -> None:
    one = publish(admin, HIDE_PROPERTIES, note="Hide it")
    assert (one["number"], one["status"], one["note"]) == (1, "published", "Hide it")
    two = publish(admin, {"features": {"quotes": False}})
    assert two["number"] == 2

    rows = {row["number"]: row for row in admin.get(VERSIONS).json()}
    assert rows[1]["status"] == "superseded"
    assert rows[2]["status"] == "published"
    assert rows[2]["created_by"] == "admin@example.com"
    # The old version still holds what it published, and no draft is left over.
    assert (
        ConfigVersion.objects.get(number=1).app_config["panels"]["properties"]["visible"] is False
    )
    assert not ConfigVersion.objects.filter(status="draft").exists()


def test_publish_needs_the_current_draft(admin: APIClient) -> None:
    assert admin.post(PUBLISH, {"revision": 1}, format="json").status_code == 409
    save(admin, {})
    save(admin, {}, 1)
    assert admin.post(PUBLISH, {"revision": 1}, format="json").status_code == 409
    assert admin.post(PUBLISH, {"revision": 2}, format="json").status_code == 200


def test_rollback_publishes_a_copy_as_a_new_version(admin: APIClient, anonymous: APIClient) -> None:
    publish(admin, HIDE_PROPERTIES)
    publish(admin, {})
    assert anonymous.get("/api/config/").json()["config"]["panels"]["properties"]["visible"] is True

    response = admin.post(f"{VERSIONS}1/rollback/", {}, format="json")

    assert response.status_code == 200
    assert response.json()["number"] == 3
    assert response.json()["note"] == "Rolled back to version 1"
    body = anonymous.get("/api/config/").json()
    assert body["version"] == 3
    assert body["config"]["panels"]["properties"]["visible"] is False
    # Version 1 is untouched: still superseded, with its own number.
    assert ConfigVersion.objects.get(number=1).status == "superseded"
    assert ConfigVersion.objects.filter(status="published").count() == 1


def test_rollback_refuses_the_published_and_missing_versions(admin: APIClient) -> None:
    publish(admin, {})
    assert admin.post(f"{VERSIONS}1/rollback/", {}, format="json").status_code == 409
    assert admin.post(f"{VERSIONS}9/rollback/", {}, format="json").status_code == 404


def test_the_database_allows_one_draft_and_one_published(admin: APIClient) -> None:
    from django.db import IntegrityError, transaction

    publish(admin, {})
    save(admin, {})
    for status, number in (("draft", None), ("published", 99)):
        with pytest.raises(IntegrityError), transaction.atomic():
            ConfigVersion.objects.create(status=status, number=number)


# --- permissions and audit --------------------------------------------------------------


@pytest.mark.parametrize("role", ["Support", "Catalog editor"])
def test_only_config_editors_may_use_the_admin_routes(db: None, role: str) -> None:
    api = staff_with(role, "other@example.com")
    assert api.get(DRAFT).status_code == 403
    assert save(api, {}).status_code == 403
    assert api.post(PUBLISH, {"revision": 1}, format="json").status_code == 403
    assert api.get(VERSIONS).status_code == 403
    assert api.post(f"{VERSIONS}1/rollback/", {}, format="json").status_code == 403


def test_a_non_staff_user_and_a_visitor_are_refused(
    client: APIClient, anonymous: APIClient, user: User
) -> None:
    assert client.get(DRAFT).status_code == 403
    assert anonymous.get(DRAFT).status_code == 401
    assert anonymous.get(VERSIONS).status_code == 401


def test_every_mutation_writes_an_audit_entry(admin: APIClient) -> None:
    publish(admin, HIDE_PROPERTIES, note="Hide it")
    admin.post(f"{VERSIONS}1/rollback/", {}, format="json")  # refused: already published
    publish(admin, {})
    admin.post(f"{VERSIONS}1/rollback/", {}, format="json")
    actions = list(
        AuditEntry.objects.filter(object_type="config_version")
        .order_by("id")
        .values_list("action", flat=True)
    )
    assert actions == [
        "config.draft.save",
        "config.publish",
        "config.draft.save",
        "config.publish",
        "config.rollback",
    ]
    entry = AuditEntry.objects.get(action="config.rollback")
    assert entry.actor_email == "admin@example.com"
    assert entry.after["restored_from"] == 1


# --- registration -----------------------------------------------------------------------


def test_registration_can_be_closed(admin: APIClient, anonymous: APIClient) -> None:
    body = {"email": "new@example.com", "password": "correct-horse-battery", "name": "New"}
    publish(admin, {"features": {"registrationOpen": False}})
    assert anonymous.post("/api/auth/register/", body, format="json").status_code == 403
    assert not User.objects.filter(email="new@example.com").exists()
    publish(admin, {})
    assert anonymous.post("/api/auth/register/", body, format="json").status_code == 201

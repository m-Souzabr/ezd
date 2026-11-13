"""The catalog: the public read, the draft, publishing, rollback and what stays immutable."""

import copy
import json

import pytest
from django.contrib.auth.models import Group, Permission
from rest_framework.test import APIClient

from accounts.models import User
from controlpanel import catalogs
from controlpanel.models import AuditEntry, CatalogVersion

from .conftest import PASSWORD
from .test_controlpanel import staff_with

CATALOG = "/api/catalog/"
DRAFT = "/api/admin/catalog/draft/"
VALIDATE = "/api/admin/catalog/validate/"
PUBLISH = "/api/admin/catalog/publish/"
VERSIONS = "/api/admin/catalog/versions/"
ENTRIES = "/api/admin/catalog/entries/"
FINISHES = "/api/admin/catalog/finishes/"


@pytest.fixture
def admin(db: None) -> APIClient:
    return staff_with("Administrator", "admin@example.com")


def seed() -> dict:
    return copy.deepcopy(catalogs.seed_catalog())


def new_entry(entry_id: str = "base.custom", **changes: object) -> dict:
    entry = next(e for e in seed()["entries"] if e["id"] == "base.standard")
    return {**entry, "id": entry_id, "name": "Custom base", **changes}


def add_entry(api: APIClient, revision: int = 0, **changes: object):
    return api.post(ENTRIES, {"revision": revision, "entry": new_entry(**changes)}, format="json")


def publish(api: APIClient, revision: int, note: str = "") -> dict:
    response = api.post(PUBLISH, {"revision": revision, "note": note}, format="json")
    assert response.status_code == 200, response.content
    return response.json()


def publish_new_entry(api: APIClient, entry_id: str = "base.custom") -> dict:
    drafted = add_entry(api, entry_id=entry_id).json()
    return publish(api, drafted["revision"], f"Add {entry_id}")


def staff_with_only(*codes: str) -> APIClient:
    group = Group.objects.create(name="Only " + "+".join(codes))
    group.permissions.add(*Permission.objects.filter(codename__in=codes))
    user = User.objects.create_user(
        email=f"{'-'.join(codes)}@example.com", password=PASSWORD, is_staff=True
    )
    user.groups.add(group)
    api = APIClient()
    api.force_login(user)
    return api


# --- the seed is the first published version --------------------------------------------


def test_the_seed_is_published_by_the_migration(db: None, anonymous: APIClient) -> None:
    row = CatalogVersion.objects.get()
    assert (row.number, row.version, row.status) == (1, "seed-1", "published")
    assert row.catalog == catalogs.seed_catalog()
    body = anonymous.get(CATALOG).json()
    assert body["version"] == "seed-1"
    assert body["catalog"] == catalogs.seed_catalog()


def test_the_public_read_needs_no_session_and_is_cached(db: None, anonymous: APIClient) -> None:
    response = anonymous.get(CATALOG)
    assert response.status_code == 200
    assert "max-age=" in response["Cache-Control"]
    assert "Cookie" not in response.get("Vary", "")


def test_without_a_row_the_api_serves_the_seed(db: None, anonymous: APIClient) -> None:
    CatalogVersion.objects.all().delete()
    assert anonymous.get(CATALOG).json()["version"] == "seed-1"
    assert anonymous.get(CATALOG + "seed-1/").status_code == 200


def test_an_old_version_is_served_forever_and_cached_hard(
    admin: APIClient, anonymous: APIClient
) -> None:
    publish_new_entry(admin)
    old = anonymous.get(CATALOG + "seed-1/")
    assert old.status_code == 200
    assert old.json()["catalog"] == catalogs.seed_catalog()
    assert "immutable" in old["Cache-Control"]
    assert anonymous.get(CATALOG + "catalog-2/").json()["version"] == "catalog-2"
    assert anonymous.get(CATALOG + "catalog-99/").status_code == 404


# --- the draft --------------------------------------------------------------------------


def test_without_a_draft_the_editor_gets_the_published_catalog(admin: APIClient) -> None:
    body = admin.get(DRAFT).json()
    assert body["revision"] == 0
    assert body["based_on"] == "seed-1"
    assert body["catalog"] == catalogs.seed_catalog()
    assert not CatalogVersion.objects.filter(status="draft").exists()


def test_saving_a_draft_bumps_the_revision_and_is_not_public(
    admin: APIClient, anonymous: APIClient
) -> None:
    catalog = seed()
    catalog["entries"][0]["name"] = "Renamed"
    first = admin.put(DRAFT, {"revision": 0, "catalog": catalog}, format="json")
    assert first.status_code == 200
    assert first.json()["revision"] == 1
    second = admin.put(DRAFT, {"revision": 1, "catalog": catalog}, format="json").json()
    assert second["revision"] == 2
    assert CatalogVersion.objects.filter(status="draft").count() == 1
    assert anonymous.get(CATALOG).json()["catalog"]["entries"][0]["name"] != "Renamed"


def test_a_stale_draft_save_is_a_409(admin: APIClient) -> None:
    catalog = seed()
    admin.put(DRAFT, {"revision": 0, "catalog": catalog}, format="json")
    assert admin.put(DRAFT, {"revision": 1, "catalog": catalog}, format="json").status_code == 200
    assert admin.put(DRAFT, {"revision": 1, "catalog": catalog}, format="json").status_code == 409
    assert admin.put(DRAFT, {"revision": 0, "catalog": catalog}, format="json").status_code == 409


def test_a_draft_may_break_a_rule_but_not_the_structure(admin: APIClient) -> None:
    catalog = seed()
    catalog["entries"][0]["price"]["baseCents"] = -1
    assert admin.put(DRAFT, {"revision": 0, "catalog": catalog}, format="json").status_code == 200
    response = admin.put(DRAFT, {"revision": 1, "catalog": {"version": "x"}}, format="json")
    assert response.status_code == 422
    assert response.json()["errors"]
    assert admin.put(DRAFT, {"revision": 1}, format="json").status_code == 400


# --- validation -------------------------------------------------------------------------


def test_validate_reports_every_problem_with_its_path(admin: APIClient) -> None:
    assert admin.post(VALIDATE, {}, format="json").json() == {"ok": True, "problems": []}
    catalog = seed()
    catalog["entries"][0]["price"]["baseCents"] = -1
    catalog["finishes"][0]["color"] = "white"
    body = admin.post(VALIDATE, {"catalog": catalog}, format="json").json()
    assert body["ok"] is False
    assert {p["path"] for p in body["problems"]} == {
        "entries.0.price.baseCents",
        "finishes.0.color",
    }
    shape = admin.post(VALIDATE, {"catalog": {"version": "x"}}, format="json").json()
    assert shape["ok"] is False and shape["problems"]


def test_validate_checks_the_draft_by_default(admin: APIClient) -> None:
    catalog = seed()
    catalog["entries"][0]["price"]["baseCents"] = -1
    admin.put(DRAFT, {"revision": 0, "catalog": catalog}, format="json")
    assert admin.post(VALIDATE, {}, format="json").json()["ok"] is False


# --- publishing -------------------------------------------------------------------------


def test_publishing_numbers_the_version_and_serves_it(
    admin: APIClient, anonymous: APIClient
) -> None:
    published = publish_new_entry(admin)
    assert published["number"] == 2
    assert published["version"] == "catalog-2"
    assert published["current"] is True
    body = anonymous.get(CATALOG).json()
    assert body["version"] == "catalog-2"
    assert body["catalog"]["version"] == "catalog-2"
    assert "base.custom" in [e["id"] for e in body["catalog"]["entries"]]
    assert not CatalogVersion.objects.filter(status="draft").exists()
    assert admin.get(DRAFT).json()["based_on"] == "catalog-2"


def test_a_catalog_that_breaks_a_rule_cannot_be_published(admin: APIClient) -> None:
    drafted = add_entry(admin, price={"baseCents": -5, "perInchWidthCents": 600}).json()
    response = admin.post(PUBLISH, {"revision": drafted["revision"]}, format="json")
    assert response.status_code == 422
    assert "entries.%d.price.baseCents" % (len(seed()["entries"])) in [
        e["path"] for e in response.json()["errors"]
    ]
    assert catalogs.published().version == "seed-1"
    assert CatalogVersion.objects.filter(status="draft").exists()


def test_a_required_entry_cannot_be_retired_and_published(admin: APIClient) -> None:
    drafted = admin.post(ENTRIES + "base.sink/retire/", {"revision": 0}, format="json").json()
    response = admin.post(PUBLISH, {"revision": drafted["revision"]}, format="json")
    assert response.status_code == 422
    assert "required by the app" in json.dumps(response.json()["errors"])


def test_publishing_needs_the_current_revision_and_a_draft(admin: APIClient) -> None:
    assert admin.post(PUBLISH, {"revision": 1}, format="json").status_code == 409
    drafted = add_entry(admin).json()
    assert admin.post(PUBLISH, {"revision": 99}, format="json").status_code == 409
    assert admin.post(PUBLISH, {"revision": 0}, format="json").status_code == 400
    publish(admin, drafted["revision"])
    assert admin.post(PUBLISH, {"revision": drafted["revision"]}, format="json").status_code == 409


def test_a_published_version_is_immutable_and_never_deleted(admin: APIClient) -> None:
    publish_new_entry(admin)
    row = CatalogVersion.objects.get(version="seed-1")
    row.note = "changed"
    with pytest.raises(ValueError, match="never changes"):
        row.save()
    with pytest.raises(ValueError, match="never deleted"):
        row.delete()
    assert CatalogVersion.objects.get(version="seed-1").note != "changed"
    assert CatalogVersion.objects.filter(status="published").count() == 2
    # A draft is not published, so it can be changed and deleted.
    draft = add_entry(admin, entry_id="base.other").json()
    row = catalogs.draft()
    assert row is not None and draft["revision"] == 1
    row.note = "x"
    row.save()
    row.delete()


def test_the_version_list_marks_the_current_one(admin: APIClient) -> None:
    publish_new_entry(admin, "base.one")
    publish_new_entry(admin, "base.two")
    rows = admin.get(VERSIONS).json()
    assert [(r["version"], r["current"]) for r in rows] == [
        ("catalog-3", True),
        ("catalog-2", False),
        ("seed-1", False),
    ]
    assert rows[0]["note"] == "Add base.two"
    assert rows[0]["created_by"] == "admin@example.com"


def test_rollback_publishes_a_copy_and_keeps_every_old_row(
    admin: APIClient, anonymous: APIClient
) -> None:
    publish_new_entry(admin)
    response = admin.post(VERSIONS + "seed-1/rollback/", {}, format="json")
    assert response.status_code == 200
    assert response.json()["version"] == "catalog-3"
    assert response.json()["note"] == "Rolled back to seed-1"
    current = anonymous.get(CATALOG).json()["catalog"]
    assert "base.custom" not in [e["id"] for e in current["entries"]]
    assert current["version"] == "catalog-3"
    assert anonymous.get(CATALOG + "catalog-2/").status_code == 200
    assert CatalogVersion.objects.filter(status="published").count() == 3
    # The version that is already current cannot be rolled back to; an unknown one is a 404.
    assert admin.post(VERSIONS + "catalog-3/rollback/", {}, format="json").status_code == 409
    assert admin.post(VERSIONS + "nope/rollback/", {}, format="json").status_code == 404


# --- entries and finishes ---------------------------------------------------------------


def test_creating_an_entry_edits_a_draft_started_from_the_published_catalog(
    admin: APIClient,
) -> None:
    response = add_entry(admin)
    assert response.status_code == 200
    body = response.json()
    assert body["revision"] == 1
    assert body["catalog"]["entries"][-1]["id"] == "base.custom"
    assert len(body["catalog"]["entries"]) == len(seed()["entries"]) + 1
    # The next change needs the new revision.
    assert add_entry(admin, revision=0, entry_id="base.other").status_code == 409
    assert add_entry(admin, revision=1, entry_id="base.other").json()["revision"] == 2


def test_an_entry_id_is_unique_and_required(admin: APIClient) -> None:
    assert add_entry(admin, entry_id="base.standard").status_code == 409
    response = admin.post(
        ENTRIES, {"revision": 0, "entry": {**new_entry(), "id": " "}}, format="json"
    )
    assert response.status_code == 400
    assert admin.post(ENTRIES, {"revision": 0, "entry": [1]}, format="json").status_code == 400
    broken = admin.post(ENTRIES, {"revision": 0, "entry": {"id": "x.y"}}, format="json")
    assert broken.status_code == 422
    assert not CatalogVersion.objects.filter(status="draft").exists()


def test_patching_an_entry_replaces_the_fields_given(admin: APIClient) -> None:
    response = admin.patch(
        ENTRIES + "base.standard/",
        {
            "revision": 0,
            "changes": {"name": "Base", "price": {"baseCents": 100, "perInchWidthCents": 5}},
        },
        format="json",
    )
    assert response.status_code == 200
    entry = next(e for e in response.json()["catalog"]["entries"] if e["id"] == "base.standard")
    assert entry["name"] == "Base"
    assert entry["price"] == {"baseCents": 100, "perInchWidthCents": 5}
    assert entry["kind"] == "base"
    cleared = admin.patch(
        ENTRIES + "base.standard/", {"revision": 1, "changes": {"retired": True}}, format="json"
    )
    assert cleared.status_code == 200
    unset = admin.patch(
        ENTRIES + "base.standard/", {"revision": 2, "changes": {"retired": None}}, format="json"
    ).json()
    assert "retired" not in next(
        e for e in unset["catalog"]["entries"] if e["id"] == "base.standard"
    )


def test_an_entry_id_cannot_change_and_an_unknown_one_is_a_404(admin: APIClient) -> None:
    response = admin.patch(
        ENTRIES + "base.standard/", {"revision": 0, "changes": {"id": "x"}}, format="json"
    )
    assert response.status_code == 400
    assert (
        admin.patch(ENTRIES + "nope/", {"revision": 0, "changes": {}}, format="json").status_code
        == 404
    )
    assert (
        admin.patch(
            ENTRIES + "base.standard/", {"revision": 0, "changes": []}, format="json"
        ).status_code
        == 400
    )
    bad = admin.patch(
        ENTRIES + "base.standard/", {"revision": 0, "changes": {"name": 5}}, format="json"
    )
    assert bad.status_code == 422


def test_retiring_and_restoring_an_entry_never_deletes_it(
    admin: APIClient, anonymous: APIClient
) -> None:
    retired = admin.post(ENTRIES + "base.drawers/retire/", {"revision": 0}, format="json").json()
    drawers = next(e for e in retired["catalog"]["entries"] if e["id"] == "base.drawers")
    assert drawers["retired"] is True
    publish(admin, retired["revision"])
    current = anonymous.get(CATALOG).json()["catalog"]
    assert next(e for e in current["entries"] if e["id"] == "base.drawers")["retired"] is True
    restored = admin.post(ENTRIES + "base.drawers/restore/", {"revision": 0}, format="json").json()
    assert "retired" not in next(
        e for e in restored["catalog"]["entries"] if e["id"] == "base.drawers"
    )
    assert admin.post(ENTRIES + "nope/retire/", {"revision": 1}, format="json").status_code == 404
    for method in (admin.delete,):
        assert method(ENTRIES + "base.drawers/").status_code == 405


def test_finishes_can_be_added_changed_and_retired(admin: APIClient) -> None:
    finish = {"id": "cabinet.teal", "name": "Teal", "target": "cabinet", "color": "#008080"}
    created = admin.post(FINISHES, {"revision": 0, "finish": finish}, format="json")
    assert created.status_code == 200
    assert admin.post(FINISHES, {"revision": 1, "finish": finish}, format="json").status_code == 409
    changed = admin.patch(
        FINISHES + "cabinet.teal/",
        {"revision": 1, "changes": {"multiplierBps": 11500}},
        format="json",
    ).json()
    assert changed["catalog"]["finishes"][-1]["multiplierBps"] == 11500
    retired = admin.post(FINISHES + "cabinet.teal/retire/", {"revision": 2}, format="json").json()
    assert retired["catalog"]["finishes"][-1]["retired"] is True
    restored = admin.post(FINISHES + "cabinet.teal/restore/", {"revision": 3}, format="json").json()
    assert "retired" not in restored["catalog"]["finishes"][-1]
    assert admin.post(FINISHES + "nope/retire/", {"revision": 4}, format="json").status_code == 404
    bad = {**finish, "id": "cabinet.bad", "color": "teal"}
    posted = admin.post(FINISHES, {"revision": 4, "finish": bad}, format="json")
    assert posted.status_code == 200  # a draft may break a rule; publishing will not allow it
    assert admin.post(PUBLISH, {"revision": 5}, format="json").status_code == 422


# --- permissions and audit --------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "url", "body"),
    [
        ("get", DRAFT, None),
        ("put", DRAFT, {"revision": 0, "catalog": {}}),
        ("post", VALIDATE, {}),
        ("post", PUBLISH, {"revision": 1}),
        ("get", VERSIONS, None),
        ("post", VERSIONS + "seed-1/rollback/", {}),
        ("post", ENTRIES, {"revision": 0, "entry": {}}),
        ("patch", ENTRIES + "base.standard/", {"revision": 0, "changes": {}}),
        ("post", ENTRIES + "base.standard/retire/", {"revision": 0}),
        ("post", ENTRIES + "base.standard/restore/", {"revision": 0}),
        ("post", FINISHES, {"revision": 0, "finish": {}}),
        ("patch", FINISHES + "cabinet.white/", {"revision": 0, "changes": {}}),
        ("post", FINISHES + "cabinet.white/retire/", {"revision": 0}),
        ("post", FINISHES + "cabinet.white/restore/", {"revision": 0}),
    ],
)
def test_no_session_a_customer_or_support_cannot_use_an_admin_route(
    db: None, anonymous: APIClient, method: str, url: str, body: dict | None
) -> None:
    support = staff_with("Support", "support@example.com")
    customer = APIClient()
    customer.force_login(User.objects.create_user(email="c@example.com", password=PASSWORD))
    for api, expected in ((anonymous, 401), (customer, 403), (support, 403)):
        response = getattr(api, method)(url, body, format="json")
        assert response.status_code == expected, (api, response.status_code)
    assert not CatalogVersion.objects.filter(status="draft").exists()


def test_editing_and_publishing_are_separate_permissions(db: None) -> None:
    editor = staff_with_only("config.catalog.edit")
    assert editor.get(DRAFT).status_code == 200
    assert add_entry(editor).status_code == 200
    assert editor.get(VERSIONS).status_code == 200
    assert editor.post(PUBLISH, {"revision": 1}, format="json").status_code == 403
    assert editor.post(VERSIONS + "seed-1/rollback/", {}, format="json").status_code == 403

    publisher = staff_with_only("config.catalog.publish")
    assert publisher.get(DRAFT).status_code == 403
    assert publisher.post(PUBLISH, {"revision": 1}, format="json").status_code == 200
    catalog_editor = staff_with("Catalog editor", "ce@example.com")
    assert catalog_editor.get(DRAFT).status_code == 200


def test_every_mutation_is_audited(admin: APIClient) -> None:
    admin.put(DRAFT, {"revision": 0, "catalog": seed()}, format="json")
    admin.post(ENTRIES, {"revision": 1, "entry": new_entry()}, format="json")
    admin.patch(ENTRIES + "base.custom/", {"revision": 2, "changes": {"name": "X"}}, format="json")
    admin.post(ENTRIES + "base.custom/retire/", {"revision": 3}, format="json")
    admin.post(ENTRIES + "base.custom/restore/", {"revision": 4}, format="json")
    finish = {"id": "cabinet.teal", "name": "Teal", "target": "cabinet", "color": "#008080"}
    admin.post(FINISHES, {"revision": 5, "finish": finish}, format="json")
    publish(admin, 6, "Teal and a custom base")
    admin.post(VERSIONS + "seed-1/rollback/", {}, format="json")
    actions = list(AuditEntry.objects.order_by("id").values_list("action", flat=True))
    assert actions == [
        "catalog.draft.save",
        "catalog.entry.create",
        "catalog.entry.update",
        "catalog.entry.retire",
        "catalog.entry.restore",
        "catalog.finish.create",
        "catalog.publish",
        "catalog.rollback",
    ]
    published = AuditEntry.objects.get(action="catalog.publish")
    assert published.actor_email == "admin@example.com"
    assert published.after == {"version": "catalog-2", "note": "Teal and a custom base"}
    updated = AuditEntry.objects.get(action="catalog.entry.update")
    assert updated.before["entry"]["name"] == "Custom base"
    assert updated.after["entry"]["name"] == "X"


def test_a_failed_change_leaves_no_audit_entry(admin: APIClient) -> None:
    add_entry(admin, entry_id="base.standard")
    admin.post(PUBLISH, {"revision": 7}, format="json")
    assert not AuditEntry.objects.exists()

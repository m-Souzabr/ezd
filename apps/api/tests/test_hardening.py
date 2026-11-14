"""Phase 15: audit viewer and retention, history diffs, import and export, reset, the dry run,
roles, conflicts, abuse limits and health."""

import csv
import io
import json
from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from controlpanel import appconfig, audit, catalogs
from controlpanel.codes import PROTECTED_ROLES
from controlpanel.diff import diff
from controlpanel.models import AuditEntry, CatalogVersion, ConfigVersion

from .conftest import PASSWORD
from .test_catalog import add_entry, new_entry, publish_new_entry, staff_with_only
from .test_catalog import publish as publish_catalog
from .test_config import DRAFT, PUBLISH, publish, save
from .test_controlpanel import staff_with

AUDIT = "/api/admin/audit/"
CATALOG_DRAFT = "/api/admin/catalog/draft/"
ROLES = "/api/admin/roles/"
RULES = {"thresholds": {"minAisle": 480}}


@pytest.fixture
def admin(db: None) -> APIClient:
    return staff_with("Administrator", "admin@example.com")


def publish_rules(api: APIClient, rules: dict, note: str = "") -> None:
    draft = api.get(DRAFT).json()
    saved = api.put(DRAFT, {"revision": draft["revision"], "rules_config": rules}, format="json")
    assert saved.status_code == 200, saved.content
    response = api.post(PUBLISH, {"revision": saved.json()["revision"], "note": note})
    assert response.status_code == 200, response.content


# --- the diff ---------------------------------------------------------------------------


def test_a_diff_walks_objects_and_matches_lists_of_objects_by_id() -> None:
    before = {"a": 1, "b": {"c": 2}, "entries": [{"id": "x", "w": 1}, {"id": "y", "w": 2}]}
    after = {"a": 1, "b": {"c": 3, "d": 4}, "entries": [{"id": "y", "w": 2}, {"id": "x", "w": 5}]}
    assert diff(before, after) == [
        {"path": "b.c", "kind": "changed", "before": 2, "after": 3},
        {"path": "b.d", "kind": "added", "after": 4},
        {"path": "entries[x].w", "kind": "changed", "before": 1, "after": 5},
    ]
    assert diff({"l": [1, 2]}, {"l": [1, 3]}) == [
        {"path": "l", "kind": "changed", "before": [1, 2], "after": [1, 3]}
    ]
    assert diff({"entries": [{"id": "x"}]}, {"entries": [{"id": "x"}, {"id": "z"}]}) == [
        {"path": "entries[z]", "kind": "added", "after": {"id": "z"}}
    ]
    assert diff({"logo": "x" * 500}, {"logo": "y" * 500})[0]["before"] == "<500 characters>"
    assert diff(1, 1) == []


# --- the audit viewer -------------------------------------------------------------------


def test_the_audit_log_filters_by_actor_action_object_type_and_date(admin: APIClient) -> None:
    other = User.objects.create_user(email="other@example.com", password=PASSWORD)
    audit.record(other, "user.update", "user", 1, before={"name": "A"}, after={"name": "B"})
    old = audit.record(admin.user, "config.publish", "config_version", 2)  # type: ignore[attr-defined]
    AuditEntry.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=10))

    def ids(**params: str) -> list[str]:
        return [row["action"] for row in admin.get(AUDIT, params).json()]

    assert "user.update" in ids(actor="other@")
    assert ids(actor="other@") == ["user.update"]
    assert ids(action="config.") == ["config.publish"]
    assert ids(object_type="config_version") == ["config.publish"]
    today = timezone.now().date().isoformat()
    assert "config.publish" not in ids(date_from=today)
    assert ids(date_to=(timezone.now() - timedelta(days=5)).date().isoformat()) == [
        "config.publish"
    ]
    assert admin.get(AUDIT, {"date_from": "yesterday"}).status_code == 400
    assert admin.get("/api/admin/audit/types/").json() == ["config_version", "user"]


def test_an_audit_row_has_a_readable_diff_with_secrets_masked(admin: APIClient) -> None:
    # Written before masking existed: the reader masks it again.
    AuditEntry.objects.create(
        action="llm.settings.update",
        object_type="llm",
        before={"llm": {"api_key": "sk-old", "model": "a"}},
        after={"llm": {"api_key": "sk-new", "model": "b"}},
    )
    row = admin.get(AUDIT).json()[0]
    assert row["changes"] == [{"path": "llm.model", "kind": "changed", "before": "a", "after": "b"}]
    assert row["before"]["llm"]["api_key"] == "[redacted]"
    assert "sk-old" not in json.dumps(row) and "sk-new" not in json.dumps(row)


def test_the_audit_log_exports_csv_without_secrets_or_formulas(admin: APIClient) -> None:
    audit.record(None, "=cmd|' /C calc'!A0", "x", after={"password": "hunter2", "ok": 1})
    response = admin.get("/api/admin/audit/export/", {"action": "="})
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/csv")
    assert "attachment" in response["Content-Disposition"]
    rows = list(csv.reader(io.StringIO(response.content.decode())))
    assert rows[0] == [
        "id",
        "time",
        "actor",
        "action",
        "object_type",
        "object_id",
        "before",
        "after",
    ]
    assert rows[1][3].startswith("'=")
    assert "hunter2" not in response.content.decode()
    assert AuditEntry.objects.filter(action="audit.export").exists()


def test_retention_is_a_command_that_keeps_all_by_default(admin: APIClient) -> None:
    old = audit.record(None, "old.thing", "x")
    AuditEntry.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=100))
    audit.record(None, "new.thing", "x")

    call_command("prune_audit")  # AUDIT_RETENTION_DAYS defaults to 0: keep everything
    assert AuditEntry.objects.filter(action="old.thing").exists()
    call_command("prune_audit", "--days", "30", "--dry-run")
    assert AuditEntry.objects.filter(action="old.thing").exists()
    call_command("prune_audit", "--days", "30")
    assert not AuditEntry.objects.filter(action="old.thing").exists()
    assert AuditEntry.objects.filter(action="new.thing").exists()
    pruned = AuditEntry.objects.get(action="audit.prune")
    assert pruned.after == {"days": 30, "deleted": 1}
    with override_settings(AUDIT_RETENTION_DAYS=1):
        AuditEntry.objects.filter(action="new.thing").update(
            created_at=timezone.now() - timedelta(days=2)
        )
        call_command("prune_audit")
    assert not AuditEntry.objects.filter(action="new.thing").exists()
    with pytest.raises(CommandError):
        call_command("prune_audit", "--days", "-1")


# --- history ----------------------------------------------------------------------------


def test_the_config_diff_compares_any_two_versions_per_section(admin: APIClient) -> None:
    publish(admin, {"panels": {"properties": {"visible": False}}})
    publish_rules(admin, RULES, "tighter aisle")
    response = admin.get("/api/admin/config/versions/diff/", {"from": 1, "to": 2})
    assert response.status_code == 200
    sections = response.json()["sections"]
    assert sections["app_config"] == []
    assert {change["path"] for change in sections["rules_config"]} >= {"thresholds.minAisle"}
    versions = admin.get("/api/admin/config/versions/").json()
    assert versions[0]["created_by"] == "admin@example.com"
    assert versions[0]["note"] == "tighter aisle"
    assert admin.get("/api/admin/config/versions/diff/", {"from": 1, "to": 99}).status_code == 404
    assert admin.get("/api/admin/config/versions/diff/", {"from": "x", "to": 1}).status_code == 400


def test_the_config_diff_leaves_out_sections_the_user_may_not_edit(admin: APIClient) -> None:
    publish_rules(admin, RULES)
    publish_rules(admin, {})
    rules_only = staff_with_only("config.rules.edit")
    sections = rules_only.get("/api/admin/config/versions/diff/", {"from": 1, "to": 2}).json()
    assert list(sections["sections"]) == ["rules_config"]


def test_the_catalog_diff_names_entries_by_id(admin: APIClient) -> None:
    publish_new_entry(admin, "base.one")
    publish_new_entry(admin, "base.two")
    response = admin.get("/api/admin/catalog/versions/diff/", {"from": 1, "to": 3})
    assert response.status_code == 200
    changes = response.json()["sections"]["catalog"]
    assert {change["path"] for change in changes} == {
        "entries[base.one]",
        "entries[base.two]",
    }
    assert all(change["kind"] == "added" for change in changes)
    assert admin.get("/api/admin/catalog/versions/diff/", {"from": 1, "to": 40}).status_code == 404


# --- export, import and reset -----------------------------------------------------------


def test_an_export_holds_every_section_the_user_may_read(admin: APIClient) -> None:
    publish_rules(admin, RULES)
    body = admin.get("/api/admin/config/export/").json()
    assert body["format"] == "ezd-config" and body["formatVersion"] == 1
    assert body["config"]["number"] == 1
    assert body["config"]["rules_config"]["thresholds"]["minAisle"] == 480
    assert body["catalog"]["version"] == catalogs.published_catalog()["version"]
    older = admin.get("/api/admin/config/export/", {"number": 1}).json()
    assert older["config"]["number"] == 1
    assert admin.get("/api/admin/config/export/", {"number": 9}).status_code == 404
    assert admin.get("/api/admin/config/export/", {"catalog": "nope"}).status_code == 404
    only_catalog = staff_with_only("config.catalog.edit").get("/api/admin/config/export/").json()
    assert "config" not in only_catalog and "catalog" in only_catalog


def test_an_import_creates_drafts_and_never_publishes(admin: APIClient) -> None:
    publish_rules(admin, RULES)
    export = admin.get("/api/admin/config/export/").json()
    export["config"]["rules_config"] = {"thresholds": {"minAisle": 528}}
    export["catalog"]["entries"].append(new_entry("base.imported"))
    published_before = list(ConfigVersion.objects.filter(status="published").values_list("pk"))

    response = admin.post("/api/admin/config/import/", {"data": export}, format="json")

    assert response.status_code == 200, response.content
    assert set(response.json()["sections"]) >= {"rules_config", "catalog"}
    draft = admin.get(DRAFT).json()
    assert draft["rules_config"]["thresholds"]["minAisle"] == 528
    assert any(
        e["id"] == "base.imported" for e in admin.get(CATALOG_DRAFT).json()["catalog"]["entries"]
    )
    assert list(ConfigVersion.objects.filter(status="published").values_list("pk")) == (
        published_before
    )
    assert appconfig.published_rules()["thresholds"]["minAisle"] == 480
    assert AuditEntry.objects.filter(action="config.import").exists()


def test_an_import_does_not_overwrite_a_draft_unless_asked(admin: APIClient) -> None:
    export = admin.get("/api/admin/config/export/").json()
    assert save(admin, {"panels": {"properties": {"visible": False}}}).status_code == 200

    refused = admin.post("/api/admin/config/import/", {"data": export}, format="json")
    assert refused.status_code == 409
    assert refused.json()["conflict"]["updated_by"] == "admin@example.com"
    replaced = admin.post(
        "/api/admin/config/import/", {"data": export, "replace": True}, format="json"
    )
    assert replaced.status_code == 200
    assert admin.get(DRAFT).json()["app_config"]["panels"]["properties"]["visible"] is True


@pytest.mark.parametrize(
    ("mutate", "path"),
    [
        (lambda d: d.update(format="other"), "format"),
        (lambda d: d.update(formatVersion=9), "formatVersion"),
        (lambda d: d.update(config=[1]), "config"),
        (lambda d: d.update(catalog="x"), "catalog"),
        (lambda d: (d.pop("config"), d.pop("catalog")), ""),
        (lambda d: d["config"].update(app_config={"panels": 5}), "panels"),
        (lambda d: d["config"].update(rules_config={"thresholds": {"minAisle": 1}}), "thresholds"),
        (lambda d: d["catalog"].update(entries="nope"), "entries"),
    ],
)
def test_importing_an_invalid_file_changes_nothing(admin: APIClient, mutate, path: str) -> None:
    export = admin.get("/api/admin/config/export/").json()
    mutate(export)

    response = admin.post("/api/admin/config/import/", {"data": export}, format="json")

    assert response.status_code == 422, response.content
    assert any(path in error["path"] for error in response.json()["errors"])
    assert not ConfigVersion.objects.filter(status="draft").exists()
    assert not CatalogVersion.objects.filter(status="draft").exists()


def test_an_import_with_one_bad_section_saves_none(admin: APIClient) -> None:
    export = admin.get("/api/admin/config/export/").json()
    export["config"]["rules_config"] = {"thresholds": {"minAisle": 528}}
    export["catalog"]["entries"] = "nope"
    assert (
        admin.post("/api/admin/config/import/", {"data": export}, format="json").status_code == 422
    )
    assert not ConfigVersion.objects.filter(status="draft").exists()


def test_an_import_needs_the_permission_of_each_section_it_holds(admin: APIClient) -> None:
    export = admin.get("/api/admin/config/export/").json()
    rules_only = staff_with_only("config.rules.edit")
    response = rules_only.post("/api/admin/config/import/", {"data": export}, format="json")
    assert response.status_code == 403
    assert not ConfigVersion.objects.filter(status="draft").exists()
    just_rules = {"format": "ezd-config", "formatVersion": 1, "config": {"rules_config": {}}}
    assert (
        rules_only.post(
            "/api/admin/config/import/", {"data": just_rules}, format="json"
        ).status_code
        == 200
    )


def test_reset_to_defaults_saves_a_draft_equal_to_the_compiled_defaults(admin: APIClient) -> None:
    publish_rules(admin, RULES)
    publish_new_entry(admin)

    rules = admin.post(
        "/api/admin/config/reset/", {"section": "rules", "revision": 0}, format="json"
    )
    assert rules.status_code == 200, rules.content
    assert admin.get(DRAFT).json()["rules_config"] == appconfig.validate_rules_config({})
    assert appconfig.published_rules()["thresholds"]["minAisle"] == 480  # still published

    for section, field in (("app", "app_config"), ("quotes", "quote_defaults")):
        revision = admin.get(DRAFT).json()["revision"]
        response = admin.post(
            "/api/admin/config/reset/", {"section": section, "revision": revision}, format="json"
        )
        assert response.status_code == 200
        assert (
            admin.get(DRAFT).json()[field]
            == {
                "app": appconfig.validate_config({}),
                "quotes": appconfig.validate_quote_defaults({}),
            }[section]
        )

    catalog = admin.post(
        "/api/admin/config/reset/", {"section": "catalog", "revision": 0}, format="json"
    )
    assert catalog.status_code == 200
    assert admin.get(CATALOG_DRAFT).json()["catalog"] == catalogs.seed_catalog()
    assert AuditEntry.objects.filter(action="config.reset").count() == 4


def test_reset_needs_the_permission_of_its_section_and_a_current_revision(
    admin: APIClient,
) -> None:
    rules_only = staff_with_only("config.rules.edit")
    body = {"section": "catalog", "revision": 0}
    assert rules_only.post("/api/admin/config/reset/", body, format="json").status_code == 403
    assert (
        rules_only.post(
            "/api/admin/config/reset/", {"section": "app", "revision": 0}, format="json"
        ).status_code
        == 403
    )
    assert save(admin, {}).status_code == 200
    stale = admin.post(
        "/api/admin/config/reset/", {"section": "rules", "revision": 0}, format="json"
    )
    assert stale.status_code == 409
    assert (
        admin.post("/api/admin/config/reset/", {"section": "x", "revision": 0}).status_code == 400
    )


# --- the dry run ------------------------------------------------------------------------


def test_the_catalog_dry_run_reports_designs_and_quotes_that_lose_an_entry(
    admin: APIClient, design, version
) -> None:
    from quotes.models import Quote

    from .test_isolation import _quote

    publish_new_entry(admin, "base.extra")
    quote = _quote(version)
    quote.lines = [*quote.lines, {**quote.lines[0], "catalogId": "base.extra"}]
    Quote.objects.filter(pk=quote.pk).update(lines=quote.lines)

    draft = admin.get(CATALOG_DRAFT).json()
    clean = admin.post("/api/admin/catalog/dry-run/").json()
    assert clean["designs"]["changed"] == 0
    assert clean["quotes"] == {"total": 1, "sampled": 1, "changed": 0, "samples": []}

    retired = admin.post(
        "/api/admin/catalog/entries/base.extra/retire/",
        {"revision": draft["revision"]},
        format="json",
    )
    assert retired.status_code == 200, retired.content
    report = admin.post("/api/admin/catalog/dry-run/").json()
    assert report["quotes"]["changed"] == 1
    assert report["quotes"]["samples"][0]["missing"] == ["base.extra"]
    assert report["quotes"]["samples"][0]["id"] == str(quote.pk)
    assert report["designs"]["sampled"] == 1


def test_the_config_dry_run_counts_designs_whose_checks_change(
    admin: APIClient, design, version
) -> None:
    clean = admin.post("/api/admin/config/dry-run/").json()
    assert clean["designs"]["sampled"] == 1 and clean["designs"]["changed"] == 0
    assert clean["quotes"]["sampled"] == 0

    # The fixture kitchen has aisles narrower than the rule wants; turning it off clears them.
    draft = admin.get(DRAFT).json()
    off = {"rules": {"clearance.aisle": {"enabled": False}}}
    saved = admin.put(DRAFT, {"revision": draft["revision"], "rules_config": off}, format="json")
    assert saved.status_code == 200, saved.content
    report = admin.post("/api/admin/config/dry-run/").json()["designs"]
    assert report["total"] == 1
    assert report["changed"] == 1, report
    sample = report["samples"][0]
    assert sample["id"] == str(design.id) and sample["name"] == "Kitchen"
    assert sample["introduced"] == []
    assert sample["cleared"] and all("aisle" in message.lower() for message in sample["cleared"])


def test_the_dry_run_of_a_draft_that_breaks_a_rule_is_a_422(
    admin: APIClient, design, version
) -> None:
    draft = add_entry(admin, entry_id="base.extra").json()
    broken = admin.post(
        "/api/admin/catalog/entries/base.standard/retire/",
        {"revision": draft["revision"]},
        format="json",
    )
    assert broken.status_code == 200, broken.content
    response = admin.post("/api/admin/catalog/dry-run/")
    assert response.status_code == 422
    assert response.json()["errors"]


# --- conflicts --------------------------------------------------------------------------


def test_a_stale_config_save_says_who_saved_first(admin: APIClient) -> None:
    other = staff_with("Administrator", "second@example.com")
    assert save(other, {"panels": {"properties": {"visible": False}}}, 0).status_code == 200
    stale = save(admin, {}, 0)
    assert stale.status_code == 409
    assert stale.json()["conflict"]["updated_by"] == "second@example.com"
    assert stale.json()["conflict"]["revision"] == 1
    assert admin.get(DRAFT).json()["updated_by"] == "second@example.com"


def test_a_stale_catalog_save_says_who_saved_first(admin: APIClient) -> None:
    other = staff_with("Administrator", "second@example.com")
    assert add_entry(other, entry_id="base.theirs").status_code == 200
    stale = add_entry(admin, entry_id="base.mine")
    assert stale.status_code == 409
    assert stale.json()["conflict"]["updated_by"] == "second@example.com"
    published = publish_catalog  # a stale publish says it too
    del published
    stale_publish = admin.post("/api/admin/catalog/publish/", {"revision": 5}, format="json")
    assert stale_publish.status_code == 409
    assert stale_publish.json()["conflict"]["updated_by"] == "second@example.com"


# --- abuse limits -----------------------------------------------------------------------


def test_admin_routes_are_throttled_per_user_and_other_routes_are_not(
    admin: APIClient, settings
) -> None:
    from rest_framework.settings import api_settings

    rates = {**api_settings.DEFAULT_THROTTLE_RATES, "admin": "3/min"}
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": rates}
    api_settings.reload()
    try:
        codes = [admin.get(AUDIT).status_code for _ in range(5)]
        assert codes == [200, 200, 200, 429, 429]
        assert admin.get("/api/auth/me/").status_code == 200
    finally:
        settings.REST_FRAMEWORK = {
            **settings.REST_FRAMEWORK,
            "DEFAULT_THROTTLE_RATES": {**rates, "admin": "100000/min"},
        }
        api_settings.reload()


def test_config_and_catalog_payloads_have_size_limits(admin: APIClient) -> None:
    huge = {"revision": 0, "app_config": {"x": "a" * (600 * 1024)}}
    assert admin.put(DRAFT, huge, format="json").status_code == 413
    huge_catalog = {"revision": 0, "catalog": {"x": "a" * (1100 * 1024)}}
    assert admin.put(CATALOG_DRAFT, huge_catalog, format="json").status_code == 413
    bomb = {"data": {"format": "ezd-config", "formatVersion": 1, "junk": "a" * (3 * 1024 * 1024)}}
    assert admin.post("/api/admin/config/import/", bomb, format="json").status_code == 413


# --- roles ------------------------------------------------------------------------------


def test_an_administrator_creates_renames_and_deletes_a_role(admin: APIClient) -> None:
    created = admin.post(ROLES, {"name": "Auditor", "permissions": ["audit.view"]}, format="json")
    assert created.status_code == 201, created.content
    role = created.json()
    assert role["protected"] is False and role["members"] == 0

    changed = admin.patch(
        f"{ROLES}{role['id']}/", {"name": "Reviewer", "permissions": ["audit.view", "users.view"]}
    )
    assert changed.status_code == 200
    assert changed.json()["permissions"] == ["audit.view", "users.view"]
    assert admin.delete(f"{ROLES}{role['id']}/").status_code == 204
    assert not Group.objects.filter(name="Reviewer").exists()
    assert [e.action for e in AuditEntry.objects.filter(object_type="role").order_by("id")] == [
        "role.create",
        "role.update",
        "role.delete",
    ]


def test_the_seeded_roles_are_protected(admin: APIClient) -> None:
    for name in PROTECTED_ROLES:
        group = Group.objects.get(name=name)
        assert admin.patch(f"{ROLES}{group.pk}/", {"name": "x"}).status_code == 403
        assert admin.delete(f"{ROLES}{group.pk}/").status_code == 403
    listed = {r["name"]: r for r in admin.get(ROLES).json()}
    assert all(listed[name]["protected"] for name in PROTECTED_ROLES)


def test_role_names_are_unique_and_not_blank(admin: APIClient) -> None:
    assert (
        admin.post(ROLES, {"name": "support", "permissions": []}, format="json").status_code == 400
    )
    assert admin.post(ROLES, {"name": "  ", "permissions": []}, format="json").status_code == 400
    assert admin.post(ROLES, {"permissions": []}, format="json").status_code == 400
    assert (
        admin.post(ROLES, {"name": "X", "permissions": ["nope"]}, format="json").status_code == 400
    )
    assert admin.patch(f"{ROLES}999999/", {"name": "x"}).status_code == 404


def test_a_role_cannot_grant_a_permission_its_editor_does_not_hold(admin: APIClient) -> None:
    manager = staff_with_only("users.roles.manage", "audit.view")
    assert (
        manager.post(
            ROLES, {"name": "Too much", "permissions": ["users.manage"]}, format="json"
        ).status_code
        == 403
    )
    ok = manager.post(ROLES, {"name": "Small", "permissions": ["audit.view"]}, format="json")
    assert ok.status_code == 201
    role_id = ok.json()["id"]
    assert (
        manager.patch(
            f"{ROLES}{role_id}/", {"permissions": ["audit.view", "users.manage"]}
        ).status_code
        == 403
    )

    # A role that holds more than the manager does cannot be edited or deleted by them.
    big = admin.post(ROLES, {"name": "Big", "permissions": ["users.manage"]}, format="json").json()
    assert manager.patch(f"{ROLES}{big['id']}/", {"name": "Small now"}).status_code == 403
    assert manager.delete(f"{ROLES}{big['id']}/").status_code == 403


def test_a_role_change_takes_effect_on_the_next_request(admin: APIClient) -> None:
    role = admin.post(
        ROLES, {"name": "Viewer", "permissions": ["audit.view"]}, format="json"
    ).json()
    member = User.objects.create_user(email="m@example.com", password=PASSWORD, is_staff=True)
    member.groups.add(Group.objects.get(pk=role["id"]))
    api = APIClient()
    api.force_login(member)
    assert api.get(AUDIT).status_code == 200
    assert api.get("/api/admin/users/").status_code == 403

    admin.patch(f"{ROLES}{role['id']}/", {"permissions": ["users.view"]})
    assert api.get(AUDIT).status_code == 403
    assert api.get("/api/admin/users/").status_code == 200
    assert api.get("/api/auth/me/").json()["permissions"] == ["users.view"]

    assert {r["name"]: r["members"] for r in admin.get(ROLES).json()}["Viewer"] == 1
    admin.delete(f"{ROLES}{role['id']}/")
    assert api.get("/api/admin/users/").status_code == 403


# --- operations -------------------------------------------------------------------------


def test_ready_reports_the_published_config(admin: APIClient, client: APIClient) -> None:
    assert client.get("/api/ready/").json()["config"] == "defaults"
    publish_rules(admin, RULES)
    assert client.get("/api/ready/").json() == {"status": "ok", "config": "ok", "catalog": "ok"}

    appconfig._parses.cache_clear()
    ConfigVersion.objects.filter(status="published").update(
        rules_config={"thresholds": {"minAisle": 1}}
    )
    response = client.get("/api/ready/")
    assert response.status_code == 200  # reported, never a failed probe
    assert response.json()["config"] == "invalid"
    appconfig._parses.cache_clear()
    catalogs._checked.cache_clear()


def test_grant_administrator_recovers_a_locked_out_account(db: None) -> None:
    lost = User.objects.create_user(email="Lost@Example.com", password=PASSWORD, is_active=False)
    call_command("grant_administrator", "lost@example.com", "--superuser")
    lost.refresh_from_db()
    assert lost.is_active and lost.is_staff and lost.is_superuser
    assert lost.groups.filter(name="Administrator").exists()
    assert AuditEntry.objects.filter(action="user.grant_administrator").exists()
    with pytest.raises(CommandError):
        call_command("grant_administrator", "nobody@example.com")
    Group.objects.filter(name="Administrator").delete()
    with pytest.raises(CommandError):
        call_command("grant_administrator", "lost@example.com")

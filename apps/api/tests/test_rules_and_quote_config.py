"""The rules configuration and the quote defaults: their sections of the config version."""

import base64
import io
import json
from pathlib import Path
from typing import Any

import pytest
from django.conf import settings
from django.contrib.auth.models import Permission
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from controlpanel import appconfig
from controlpanel.catalogs import core
from controlpanel.codes import APP_EDIT, QUOTE_EDIT, RULES_EDIT
from controlpanel.logo import process_logo
from controlpanel.models import AuditEntry, ConfigVersion
from projects.models import Design
from quotes.models import Quote

from .test_config import DRAFT, PUBLISH, VERSIONS
from .test_controlpanel import staff_with
from .test_quotes import payload, png_bytes, png_url

PARITY = json.loads(
    (Path(settings.REPO_DIR) / "packages/core/test-vectors/rules-parity.json").read_text("utf-8")
)
RULES = {
    "rules": {"clearance.aisle": {"severity": "error"}, "room.open": {"enabled": False}},
    "thresholds": {"minAisle": 480},
}
RATES = {"markupBps": 1500, "taxBps": 825}
BRANDING = {
    "numberPrefix": "AK-",
    "companyName": "Acme Kitchens",
    "address": "1 Main St\nSpringfield",
    "contact": "555-0100",
    "footerText": "Prices good for 30 days.",
}


# A 1 by 1 RGB PNG and a tiny JPEG, as data URIs.
def image_url(fmt: str, mode: str = "RGB", size: tuple[int, int] = (24, 12)) -> str:
    """A real image as a data URI, which the server decodes and re-encodes."""
    out = io.BytesIO()
    Image.new(mode, size, "red").save(out, fmt)
    mime = "image/png" if fmt == "PNG" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(out.getvalue()).decode()}"


# What the server stores for these: its own re-encoding, which re-encoding does not change.
PIXEL = process_logo(image_url("PNG"))
JPEG = process_logo(image_url("JPEG"))


def staff_holding(*codes: str, email: str = "holder@example.com") -> APIClient:
    api = staff_with(None, email)
    user: User = api.user  # type: ignore[attr-defined]
    user.user_permissions.add(*Permission.objects.filter(codename__in=codes))
    return api


@pytest.fixture
def admin(db: None) -> APIClient:
    return staff_with("Administrator", "admin@example.com")


def put(api: APIClient, revision: int = 0, **sections: Any):
    return api.put(DRAFT, {"revision": revision, **sections}, format="json")


def publish_sections(api: APIClient, **sections: Any) -> dict[str, Any]:
    revision = api.get(DRAFT).json()["revision"]
    saved = put(api, revision, **sections)
    assert saved.status_code == 200, saved.content
    response = api.post(PUBLISH, {"revision": saved.json()["revision"]}, format="json")
    assert response.status_code == 200, response.content
    return response.json()


# --- delivery ---------------------------------------------------------------------------


def test_with_nothing_published_the_sections_are_empty_so_clients_use_the_defaults(
    db: None, anonymous: APIClient
) -> None:
    body = anonymous.get("/api/config/").json()
    assert body["rules_config"] == {}
    assert body["quote_defaults"] == {}


def test_the_public_read_serves_the_filled_sections_without_the_logo(
    admin: APIClient, anonymous: APIClient
) -> None:
    publish_sections(
        admin,
        rules_config=RULES,
        quote_defaults={**RATES, "branding": {**BRANDING, "logo": PIXEL}},
    )
    body = anonymous.get("/api/config/").json()
    assert body["rules_config"]["thresholds"]["minAisle"] == 480
    assert body["rules_config"]["thresholds"]["minCabinetGap"] == 144
    assert body["rules_config"]["rules"]["room.open"] == {"enabled": False, "severity": "info"}
    assert body["quote_defaults"]["markupBps"] == 1500
    assert body["quote_defaults"]["branding"]["companyName"] == "Acme Kitchens"
    assert body["quote_defaults"]["branding"]["logo"] == ""
    # The version itself keeps the logo.
    assert appconfig.published_quote_defaults()["branding"]["logo"] == PIXEL


def test_the_draft_carries_all_three_sections_and_starts_from_the_published_ones(
    admin: APIClient,
) -> None:
    publish_sections(admin, rules_config=RULES)
    draft = admin.get(DRAFT).json()
    assert draft["rules_config"]["thresholds"]["minAisle"] == 480
    # Publishing stores every section with its defaults filled in.
    assert draft["quote_defaults"]["markupBps"] == 0
    assert draft["app_config"]["features"]["quotes"] is True


def test_saving_one_section_leaves_the_others_as_published(admin: APIClient) -> None:
    publish_sections(admin, app_config={"features": {"quotes": False}}, rules_config=RULES)
    saved = put(admin, 0, quote_defaults=RATES).json()
    assert saved["app_config"]["features"]["quotes"] is False
    assert saved["rules_config"]["thresholds"]["minAisle"] == 480
    assert saved["quote_defaults"]["markupBps"] == 1500
    # And a later save of another section keeps this one.
    again = put(admin, saved["revision"], rules_config={}).json()
    assert again["quote_defaults"]["markupBps"] == 1500
    assert again["rules_config"]["thresholds"]["minAisle"] == 576


def test_a_save_must_give_a_section(admin: APIClient) -> None:
    assert put(admin).status_code == 400


# --- validation -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("section", "value", "path"),
    [
        (
            "rules_config",
            {"rules": {"item.overlap": {"enabled": False}}},
            "rules.item.overlap.enabled",
        ),
        (
            "rules_config",
            {"rules": {"size.standard": {"severity": "info"}}},
            "rules.size.standard.severity",
        ),
        ("rules_config", {"rules": {"made.up": {}}}, "rules"),
        ("rules_config", {"thresholds": {"minAisle": 23 * 16}}, "thresholds.minAisle"),
        ("rules_config", {"thresholds": {"minAisle": 73 * 16}}, "thresholds.minAisle"),
        ("rules_config", {"thresholds": {"minAisle": 40.5}}, "thresholds.minAisle"),
        ("rules_config", {"snap": {"freeRotationStep": 7}}, "snap.freeRotationStep"),
        ("rules_config", [], ""),
        ("quote_defaults", {"markupBps": -1}, "markupBps"),
        ("quote_defaults", {"discountBps": 10001}, "discountBps"),
        ("quote_defaults", {"currency": "EUR"}, "currency"),
        ("quote_defaults", {"branding": {"numberPrefix": "no spaces"}}, "branding.numberPrefix"),
        ("quote_defaults", {"branding": {"logo": "https://example.com/logo.png"}}, "branding.logo"),
    ],
)
def test_an_invalid_section_is_a_422_with_core_paths_and_nothing_is_stored(
    admin: APIClient, section: str, value: Any, path: str
) -> None:
    response = put(admin, 0, **{section: value})
    assert response.status_code == 422, response.content
    assert path in [error["path"] for error in response.json()["errors"]]
    assert not ConfigVersion.objects.exists()


def test_a_logo_must_be_a_jpeg_or_a_png_without_an_alpha_channel(admin: APIClient) -> None:
    def save(logo: str):
        return put(admin, 0, quote_defaults={"branding": {"logo": logo}})

    assert save(JPEG).status_code == 200
    ConfigVersion.objects.all().delete()
    assert save(PIXEL).status_code == 200
    ConfigVersion.objects.all().delete()
    for bad, message in [
        (image_url("PNG", "RGBA"), "alpha"),
        (png_url(b"not a png at all, just text"), "not a PNG"),
        ("data:image/jpeg;base64," + base64.b64encode(b"nope" * 20).decode(), "not a JPEG"),
        # A JPEG that says it is a PNG: the type is read from the content.
        (image_url("JPEG").replace("image/jpeg", "image/png"), "not a PNG"),
        ("data:image/gif;base64,R0lGODlhAQABAAAAACw=", "PNG or JPEG"),
        ("data:image/png;base64,AAAAA", "base64"),
        (png_url(png_bytes(160_000)), "150 KB"),
        (image_url("PNG", size=(3000, 3000)), "too many pixels"),
    ]:
        response = save(bad)
        assert response.status_code == 422, (message, response.content)
        error = response.json()["errors"][0]
        assert error["path"] == "branding.logo"
        if message != "150 KB":
            assert message in error["message"]


def test_a_logo_is_re_encoded_shrunk_and_stripped_of_metadata(admin: APIClient) -> None:
    big = io.BytesIO()
    image = Image.new("RGB", (1600, 400), "blue")
    image.save(big, "JPEG", exif=Image.Exif())
    uploaded = "data:image/jpeg;base64," + base64.b64encode(big.getvalue()).decode()

    response = put(admin, 0, quote_defaults={"branding": {"logo": uploaded}})

    assert response.status_code == 200, response.content
    stored = response.json()["quote_defaults"]["branding"]["logo"]
    assert stored != uploaded
    decoded = Image.open(io.BytesIO(base64.b64decode(stored.split(",", 1)[1])))
    assert decoded.format == "JPEG"
    assert decoded.size == (800, 200)
    assert not decoded.getexif()


# --- permissions ------------------------------------------------------------------------

SECTION_FOR = {
    APP_EDIT: ("app_config", {}),
    RULES_EDIT: ("rules_config", RULES),
    QUOTE_EDIT: ("quote_defaults", RATES),
}


@pytest.mark.parametrize("held", [APP_EDIT, RULES_EDIT, QUOTE_EDIT])
@pytest.mark.parametrize("wanted", [APP_EDIT, RULES_EDIT, QUOTE_EDIT])
def test_each_section_needs_its_own_permission_to_save(db: None, held: str, wanted: str) -> None:
    api = staff_holding(held)
    name, value = SECTION_FOR[wanted]
    response = put(api, 0, **{name: value})
    assert response.status_code == (200 if held == wanted else 403), response.content
    if held != wanted:
        assert not ConfigVersion.objects.exists()


def test_a_save_of_several_sections_needs_every_one(db: None) -> None:
    api = staff_holding(RULES_EDIT)
    assert put(api, 0, rules_config=RULES, quote_defaults=RATES).status_code == 403
    assert not ConfigVersion.objects.exists()
    both = staff_holding(RULES_EDIT, QUOTE_EDIT, email="both@example.com")
    assert put(both, 0, rules_config=RULES, quote_defaults=RATES).status_code == 200


@pytest.mark.parametrize("code", [APP_EDIT, RULES_EDIT, QUOTE_EDIT])
def test_any_edit_permission_reads_the_draft_and_the_versions(db: None, code: str) -> None:
    api = staff_holding(code)
    assert api.get(DRAFT).status_code == 200
    assert api.get(VERSIONS).status_code == 200


@pytest.mark.parametrize("role", ["Support", "Catalog editor"])
def test_other_roles_still_cannot_use_the_config_routes(db: None, role: str) -> None:
    api = staff_with(role, "other@example.com")
    assert api.get(DRAFT).status_code == 403
    assert put(api, 0, rules_config=RULES).status_code == 403
    assert put(api, 0, quote_defaults=RATES).status_code == 403


def test_a_visitor_and_a_non_staff_account_are_refused(
    anonymous: APIClient, client: APIClient
) -> None:
    assert put(anonymous, 0, rules_config=RULES).status_code == 401
    assert put(client, 0, rules_config=RULES).status_code == 403


def test_a_superuser_holds_every_section(db: None) -> None:
    api = staff_with(None, "root@example.com", is_superuser=True)
    assert put(api, 0, rules_config=RULES, quote_defaults=RATES, app_config={}).status_code == 200


def test_publishing_needs_the_permission_for_each_section_that_changed(db: None) -> None:
    rules_editor = staff_holding(RULES_EDIT)
    app_editor = staff_holding(APP_EDIT, email="app@example.com")
    assert put(app_editor, 0, app_config={"features": {"quotes": False}}).status_code == 200
    revision = rules_editor.get(DRAFT).json()["revision"]
    saved = put(rules_editor, revision, rules_config=RULES)
    assert saved.status_code == 200
    # The draft also holds the app settings change, which the rules editor may not publish.
    refused = rules_editor.post(PUBLISH, {"revision": saved.json()["revision"]}, format="json")
    assert refused.status_code == 403
    assert "the app settings" in refused.json()["detail"]
    assert appconfig.published() is None
    # Whoever may edit everything it changes can.
    allowed = staff_holding(APP_EDIT, RULES_EDIT, email="both@example.com")
    assert (
        allowed.post(PUBLISH, {"revision": saved.json()["revision"]}, format="json").status_code
        == 200
    )


def test_a_rules_editor_publishes_a_draft_that_only_changes_the_rules(db: None) -> None:
    api = staff_holding(RULES_EDIT)
    published = publish_sections(api, rules_config=RULES)
    assert published["number"] == 1
    assert appconfig.published_rules()["thresholds"]["minAisle"] == 480


def test_publishing_validates_every_section_again(admin: APIClient) -> None:
    put(admin, 0, rules_config=RULES)
    # A row the API would not have saved, such as one edited in the database.
    ConfigVersion.objects.filter(status="draft").update(
        rules_config={"rules": {"item.overlap": {"enabled": False}}}
    )
    response = admin.post(PUBLISH, {"revision": 1}, format="json")
    assert response.status_code == 422
    assert appconfig.published() is None


def test_rollback_restores_all_three_sections_as_a_new_version(admin: APIClient) -> None:
    publish_sections(
        admin, app_config={}, rules_config=RULES, quote_defaults={"branding": BRANDING}
    )
    publish_sections(admin, rules_config={}, quote_defaults={})
    assert appconfig.published_rules()["thresholds"]["minAisle"] == 576
    response = admin.post(f"{VERSIONS}1/rollback/", {}, format="json")
    assert response.status_code == 200
    assert response.json()["number"] == 3
    assert appconfig.published_rules()["thresholds"]["minAisle"] == 480
    assert appconfig.published_quote_defaults()["branding"]["companyName"] == "Acme Kitchens"
    # The old rows did not change.
    assert ConfigVersion.objects.get(number=2).rules_config["thresholds"]["minAisle"] == 576


def test_rollback_needs_the_permission_for_the_sections_it_changes(db: None) -> None:
    admin = staff_with("Administrator", "admin@example.com")
    publish_sections(admin, rules_config=RULES)
    publish_sections(admin, rules_config={})
    quote_editor = staff_holding(QUOTE_EDIT)
    assert quote_editor.post(f"{VERSIONS}1/rollback/", {}, format="json").status_code == 403
    rules_editor = staff_holding(RULES_EDIT, email="rules@example.com")
    assert rules_editor.post(f"{VERSIONS}1/rollback/", {}, format="json").status_code == 200


def test_the_audit_log_keeps_the_sections_but_not_the_logo(admin: APIClient) -> None:
    publish_sections(
        admin,
        rules_config=RULES,
        quote_defaults={"branding": {**BRANDING, "logo": PIXEL}},
    )
    entry = AuditEntry.objects.get(action="config.publish")
    assert entry.after["rules_config"]["thresholds"]["minAisle"] == 480
    assert entry.after["quote_defaults"]["branding"]["companyName"] == "Acme Kitchens"
    assert entry.after["quote_defaults"]["branding"]["logo"].startswith("<logo of ")
    assert PIXEL not in json.dumps(entry.after)
    saved = AuditEntry.objects.filter(action="config.draft.save").first()
    assert saved is not None and PIXEL not in json.dumps(saved.after)


# --- the checks use what is published ---------------------------------------------------


def test_the_cli_checks_a_design_as_the_browser_does_with_the_published_rules(
    admin: APIClient,
) -> None:
    publish_sections(admin, rules_config=PARITY["rules"])
    served = appconfig.published_rules()
    document = PARITY["document"]
    configured = core("validate", {"document": document, "rules": served})
    assert configured["violations"] == PARITY["expected"]
    plain = core("validate", {"document": document})
    assert plain["violations"] == PARITY["expectedDefaults"]
    # What the server stored is what the browser would read, whole.
    assert served == core("validate-rules-config", PARITY["rules"])["config"]


def test_the_assistants_dry_run_uses_the_published_severities(admin: APIClient) -> None:
    publish_sections(admin, rules_config={"rules": {"gap.needs-filler": {"severity": "error"}}})
    # An empty room, so a cabinet 3 in from the end of a wall is the only thing to find.
    document = {**PARITY["document"], "items": [], "countertops": []}
    call = {
        "name": "add_item",
        "arguments": {"catalogId": "base.standard", "widthIn": 30, "wall": "A", "offsetIn": 3},
    }
    request = {"document": document, "toolCalls": [call], "aliases": {}}
    plain = core("llm-dry-run", request)
    assert plain["ok"] is True, plain["errors"]
    refused = core("llm-dry-run", {**request, "rules": appconfig.published_rules()})
    assert refused["ok"] is False
    assert "filler" in refused["errors"][0]["message"]


# --- quote branding ---------------------------------------------------------------------


@pytest.fixture
def design_of(client: APIClient, design: Design) -> Design:
    return design


def create_quote(client: APIClient, design: Design, revision: int) -> dict[str, Any]:
    response = client.post(f"/api/designs/{design.id}/quotes/", payload(draft_revision=revision))
    assert response.status_code == 201, response.content
    return response.json()


def test_a_quote_keeps_the_branding_published_when_it_was_created(
    admin: APIClient, client: APIClient, design: Design
) -> None:
    publish_sections(
        admin,
        quote_defaults={"branding": {**BRANDING, "logo": PIXEL}},
    )
    first = create_quote(client, design, 1)
    assert first["branding"] == {**BRANDING, "logo": PIXEL}

    publish_sections(
        admin,
        quote_defaults={"branding": {"companyName": "Other Co", "numberPrefix": "X"}},
    )
    again = client.get(f"/api/quotes/{first['id']}/").json()
    assert again == first
    assert Quote.objects.get(pk=first["id"]).branding["companyName"] == "Acme Kitchens"

    second = create_quote(client, design, 1)
    assert second["branding"]["companyName"] == "Other Co"
    assert second["branding"]["logo"] == ""
    assert second["number"] == 2


def test_the_branding_comes_from_the_server_not_the_request(
    admin: APIClient, client: APIClient, design: Design
) -> None:
    publish_sections(admin, quote_defaults={"branding": BRANDING})
    body = payload()
    body["branding"] = {**BRANDING, "companyName": "Mallory Inc"}
    response = client.post(f"/api/designs/{design.id}/quotes/", body)
    assert response.status_code == 201
    assert response.json()["branding"]["companyName"] == "Acme Kitchens"


def test_a_quote_from_before_branding_has_none(client: APIClient, design: Design) -> None:
    created = create_quote(client, design, 1)
    Quote.objects.filter(pk=created["id"]).update(branding={})
    read = client.get(f"/api/quotes/{created['id']}/").json()
    assert read["branding"] == appconfig.EMPTY_BRANDING

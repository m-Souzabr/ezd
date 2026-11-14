"""Roles, the audit log and the user manager."""

import pytest
from django.contrib.auth.models import Group
from django.contrib.sessions.models import Session
from django.core import mail
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from chat.models import Usage
from chat.usage import current_month
from controlpanel.codes import ALL_CODES
from controlpanel.models import AuditEntry
from controlpanel.permissions import permissions_of
from projects.models import Project

from .conftest import PASSWORD


def staff_with(role: str | None, email: str, **extra: bool) -> APIClient:
    user = User.objects.create_user(email=email, password=PASSWORD, is_staff=True, **extra)
    if role:
        user.groups.add(Group.objects.get(name=role))
    api = APIClient()
    api.force_login(user)
    api.user = user  # type: ignore[attr-defined]
    return api


@pytest.fixture
def administrator(db: None) -> APIClient:
    return staff_with("Administrator", "admin@example.com")


@pytest.fixture
def superuser(db: None) -> APIClient:
    return staff_with(None, "root@example.com", is_superuser=True)


@pytest.fixture
def support(db: None) -> APIClient:
    return staff_with("Support", "support@example.com")


@pytest.fixture
def catalog_editor(db: None) -> APIClient:
    return staff_with("Catalog editor", "catalog@example.com")


# --- roles ------------------------------------------------------------------------------


def test_the_seeded_roles_hold_their_permissions(db: None) -> None:
    roles = {
        group.name: {p.codename for p in group.permissions.all()} for group in Group.objects.all()
    }
    assert roles["Administrator"] == set(ALL_CODES)
    assert roles["Catalog editor"] == {"config.catalog.edit", "config.catalog.publish"}
    assert roles["Support"] == {"users.view", "users.manage"}


def test_a_superuser_holds_every_permission(superuser: APIClient) -> None:
    assert permissions_of(superuser.user) == list(ALL_CODES)  # type: ignore[attr-defined]


def test_me_lists_the_permissions(support: APIClient, client: APIClient) -> None:
    me = support.get("/api/auth/me/").json()
    assert me["permissions"] == ["users.view", "users.manage"]
    assert me["is_superuser"] is False
    assert client.get("/api/auth/me/").json()["permissions"] == []


def test_a_non_staff_user_holding_a_permission_is_refused(client: APIClient, user: User) -> None:
    user.groups.add(Group.objects.get(name="Administrator"))
    assert client.get("/api/admin/users/").status_code == 403


# --- the user list ----------------------------------------------------------------------


def test_the_list_shows_counts_roles_and_this_months_usage(support: APIClient, user: User) -> None:
    Project.objects.create(owner=user, name="One")
    Project.objects.create(owner=user, name="Two")
    Project.objects.create(owner=user, name="Gone", archived_at=user.date_joined)
    Usage.objects.create(user=user, month=current_month(), input_tokens=70, output_tokens=30)
    Usage.objects.create(user=user, month=current_month().replace(year=2020), input_tokens=999)

    rows = {row["email"]: row for row in support.get("/api/admin/users/").json()}

    assert rows[user.email]["active_projects"] == 2
    assert rows[user.email]["chat_tokens_this_month"] == 100
    assert rows["support@example.com"]["roles"] == ["Support"]
    assert "password" not in rows[user.email]


def test_the_list_costs_the_same_queries_for_any_number_of_users(
    support: APIClient, user: User
) -> None:
    def cost() -> int:
        with CaptureQueriesContext(connection) as queries:
            assert support.get("/api/admin/users/").status_code == 200
        return len(queries)

    baseline = cost()
    for n in range(15):
        member = User.objects.create_user(email=f"u{n}@example.com", password="x")
        member.groups.add(Group.objects.get(name="Support"))
        Project.objects.create(owner=member, name="P")
    assert cost() == baseline


def test_search_filter_sort_and_pagination(support: APIClient, user: User) -> None:
    User.objects.create_user(email="zed@example.com", password="x", name="Zed", is_active=False)
    get = lambda query: support.get(f"/api/admin/users/?{query}")  # noqa: E731

    assert [r["email"] for r in get("search=zed").json()] == ["zed@example.com"]
    assert [r["email"] for r in get("search=ada").json()] == ["ada@example.com"]
    assert [r["email"] for r in get("is_active=false").json()] == ["zed@example.com"]
    assert [r["email"] for r in get("role=Support").json()] == ["support@example.com"]
    assert get("is_staff=true").json()[0]["email"] == "support@example.com"
    assert get("sort=-email").json()[0]["email"] == "zed@example.com"
    page = get("limit=1&offset=1")
    assert len(page.json()) == 1
    assert page["X-Total-Count"] == "3"


# --- invite and update ------------------------------------------------------------------


def test_inviting_creates_an_account_and_emails_a_link(administrator: APIClient) -> None:
    response = administrator.post(
        "/api/admin/users/",
        {"email": "New@Example.com", "name": "Newt", "roles": ["Support"], "is_staff": True},
        format="json",
    )

    assert response.status_code == 201
    created = User.objects.get(email="New@example.com")
    assert not created.has_usable_password()
    assert created.is_staff
    assert response.json()["roles"] == ["Support"]
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["New@example.com"]
    assert "/reset-password?uid=" in mail.outbox[0].body
    assert "invited" in mail.outbox[0].subject


def test_an_invite_with_a_taken_email_is_refused_whatever_its_case(
    administrator: APIClient, user: User
) -> None:
    response = administrator.post("/api/admin/users/", {"email": user.email.upper()}, format="json")
    assert response.status_code == 400
    assert not mail.outbox


def test_the_invited_user_can_choose_a_password_and_sign_in(administrator: APIClient) -> None:
    administrator.post("/api/admin/users/", {"email": "new@example.com"}, format="json")
    link = next(w for w in mail.outbox[0].body.split() if "uid=" in w)
    uid, token = link.split("uid=")[1].split("&token=")
    anonymous = APIClient(enforce_csrf_checks=False)
    done = anonymous.post(
        "/api/auth/password-reset/confirm/",
        {"uid": uid, "token": token, "password": "a-long-fresh-password"},
        format="json",
    )
    assert done.status_code == 204
    assert (
        anonymous.post(
            "/api/auth/login/",
            {"email": "new@example.com", "password": "a-long-fresh-password"},
            format="json",
        ).status_code
        == 200
    )


def test_support_cannot_assign_roles_but_can_edit_the_rest(support: APIClient, user: User) -> None:
    refused = support.patch(
        f"/api/admin/users/{user.pk}/", {"roles": ["Administrator"]}, format="json"
    )
    assert refused.status_code == 403
    assert user.groups.count() == 0
    assert (
        support.post(
            "/api/admin/users/", {"email": "n@example.com", "roles": ["Support"]}, format="json"
        ).status_code
        == 403
    )

    ok = support.patch(f"/api/admin/users/{user.pk}/", {"name": "Ada L."}, format="json")
    assert ok.status_code == 200
    assert ok.json()["name"] == "Ada L."


def test_an_administrator_changes_roles_and_unknown_roles_are_refused(
    administrator: APIClient, user: User
) -> None:
    url = f"/api/admin/users/{user.pk}/"
    ok = administrator.patch(url, {"roles": ["Catalog editor"]}, format="json")
    assert ok.json()["roles"] == ["Catalog editor"]
    assert administrator.patch(url, {"roles": ["Nope"]}, format="json").status_code == 400


def test_email_is_unique_without_regard_to_case_on_update(
    administrator: APIClient, user: User, other_user: User
) -> None:
    response = administrator.patch(
        f"/api/admin/users/{user.pk}/", {"email": "BOB@example.com"}, format="json"
    )
    assert response.status_code == 400
    same = administrator.patch(
        f"/api/admin/users/{user.pk}/", {"email": "ADA@example.com"}, format="json"
    )
    assert same.status_code == 200


def test_reset_password_emails_the_user_even_with_no_password_yet(
    administrator: APIClient,
) -> None:
    invited = User.objects.create_user(email="inv@example.com", password=None)
    response = administrator.post(f"/api/admin/users/{invited.pk}/reset-password/")
    assert response.status_code == 204
    assert mail.outbox[0].to == ["inv@example.com"]
    assert "Reset your EZDesign password" in mail.outbox[0].subject


def test_reset_password_refuses_an_inactive_account(administrator: APIClient, user: User) -> None:
    user.is_active = False
    user.save()
    assert administrator.post(f"/api/admin/users/{user.pk}/reset-password/").status_code == 400
    assert not mail.outbox


# --- guards -----------------------------------------------------------------------------


def test_deactivating_ends_the_sessions_and_blocks_sign_in(
    administrator: APIClient, user: User, client: APIClient
) -> None:
    assert client.get("/api/projects/").status_code == 200
    assert Session.objects.count() >= 1

    response = administrator.patch(
        f"/api/admin/users/{user.pk}/", {"is_active": False}, format="json"
    )

    assert response.status_code == 200
    assert client.get("/api/projects/").status_code in (401, 403)
    assert not any(
        s.get_decoded().get("_auth_user_id") == str(user.pk) for s in Session.objects.all()
    )
    login = APIClient().post(
        "/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json"
    )
    assert login.status_code == 401


def test_nobody_deactivates_or_demotes_themselves(
    superuser: APIClient, administrator: APIClient
) -> None:
    root = superuser.user  # type: ignore[attr-defined]
    admin = administrator.user  # type: ignore[attr-defined]
    User.objects.create_user(email="root2@example.com", password="x", is_superuser=True)

    assert (
        administrator.patch(
            f"/api/admin/users/{admin.pk}/", {"is_active": False}, format="json"
        ).status_code
        == 400
    )
    assert (
        administrator.patch(
            f"/api/admin/users/{admin.pk}/", {"is_staff": False}, format="json"
        ).status_code
        == 400
    )
    assert (
        superuser.patch(
            f"/api/admin/users/{root.pk}/", {"is_superuser": False}, format="json"
        ).status_code
        == 400
    )


def test_only_a_superuser_grants_superuser(
    administrator: APIClient, superuser: APIClient, user: User
) -> None:
    url = f"/api/admin/users/{user.pk}/"
    assert administrator.patch(url, {"is_superuser": True}, format="json").status_code == 400
    assert superuser.patch(url, {"is_superuser": True}, format="json").status_code == 200
    user.refresh_from_db()
    assert user.is_superuser
    assert administrator.patch(url, {"is_superuser": False}, format="json").status_code == 400


def test_the_last_active_superuser_cannot_be_demoted_or_deactivated(
    administrator: APIClient, db: None
) -> None:
    only = User.objects.create_user(email="only@example.com", password="x", is_superuser=True)
    # Another superuser who is deactivated does not count.
    User.objects.create_user(
        email="old@example.com", password="x", is_superuser=True, is_active=False
    )
    boss = staff_with(None, "boss@example.com", is_superuser=True)
    url = f"/api/admin/users/{only.pk}/"

    # `boss` and `only` are two active superusers: demoting `only` is fine once.
    assert boss.patch(url, {"is_active": False}, format="json").status_code == 200
    # Now `boss` is the last one; an administrator (not superuser) cannot touch them anyway.
    other = f"/api/admin/users/{boss.user.pk}/"  # type: ignore[attr-defined]
    assert administrator.patch(other, {"is_active": False}, format="json").status_code == 400
    assert administrator.patch(other, {"is_superuser": False}, format="json").status_code == 400
    boss.user.refresh_from_db()  # type: ignore[attr-defined]
    assert boss.user.is_active and boss.user.is_superuser  # type: ignore[attr-defined]


# --- the Django admin -------------------------------------------------------------------


def test_the_django_admin_keeps_the_last_superuser(db: None) -> None:
    last = User.objects.create_superuser(email="last@example.com", password="x")
    client = APIClient()
    helper = User.objects.create_superuser(email="helper@example.com", password="x")
    client.force_login(helper)
    # Two active superusers: the helper may delete `last`, so deactivate the helper first.
    helper.is_active = False
    helper.save()
    client.force_login(last)

    assert client.get(f"/admin/accounts/user/{last.pk}/delete/").status_code == 403
    assert User.objects.filter(pk=last.pk).exists()


def test_the_django_admin_refuses_to_demote_the_last_superuser(db: None) -> None:
    last = User.objects.create_superuser(email="last@example.com", password="x")
    client = APIClient()
    client.force_login(last)
    data = {
        "email": last.email,
        "name": "",
        "is_active": "on",
        "is_staff": "on",
        "date_joined_0": "2026-01-01",
        "date_joined_1": "00:00:00",
    }

    client.post(f"/admin/accounts/user/{last.pk}/change/", data)

    last.refresh_from_db()
    assert last.is_superuser


def test_the_django_admin_bulk_delete_keeps_a_superuser(db: None) -> None:
    from django.contrib.admin.sites import site
    from django.test import RequestFactory

    from accounts.admin import UserAdmin

    a = User.objects.create_superuser(email="a@example.com", password="x")
    b = User.objects.create_superuser(email="b@example.com", password="x")
    request = RequestFactory().post("/admin/")
    request.user = User.objects.create_user(email="c@example.com", password="x")
    request.session = {}
    request._messages = type("M", (), {"add": lambda *args, **kwargs: None})()  # noqa: SLF001

    UserAdmin(User, site).delete_queryset(request, User.objects.filter(pk__in=[a.pk, b.pk]))

    assert User.objects.filter(is_superuser=True).count() == 2


# --- the audit log ----------------------------------------------------------------------


def test_every_mutation_writes_an_audit_entry_without_secrets(
    administrator: APIClient, user: User
) -> None:
    administrator.post("/api/admin/users/", {"email": "new@example.com"}, format="json")
    administrator.patch(f"/api/admin/users/{user.pk}/", {"name": "Ada L."}, format="json")
    administrator.post(f"/api/admin/users/{user.pk}/reset-password/")
    administrator.patch(
        "/api/llm/settings/", {"api_key": "sk-super-secret-key-9999"}, format="json"
    )

    entries = {e.action: e for e in AuditEntry.objects.all()}
    assert set(entries) == {
        "user.invite",
        "user.update",
        "user.reset_password",
        "llm.settings.update",
    }
    assert entries["user.update"].before["name"] == "Ada"
    assert entries["user.update"].after["name"] == "Ada L."
    assert entries["user.invite"].actor == administrator.user  # type: ignore[attr-defined]
    dump = str([(e.before, e.after) for e in AuditEntry.objects.all()])
    assert "sk-super-secret" not in dump
    assert "pbkdf2" not in dump
    assert entries["llm.settings.update"].after["key_changed"] is True


def test_scrub_redacts_secret_keys_at_any_depth() -> None:
    from controlpanel.audit import scrub

    assert scrub({"a": [{"password": "x", "ok": 1}], "api_key": "k"}) == {
        "a": [{"password": "[redacted]", "ok": 1}],
        "api_key": "[redacted]",
    }


def test_the_audit_log_is_paginated_and_filterable(administrator: APIClient, user: User) -> None:
    administrator.patch(f"/api/admin/users/{user.pk}/", {"name": "A"}, format="json")
    administrator.post(f"/api/admin/users/{user.pk}/reset-password/")
    actor = administrator.user  # type: ignore[attr-defined]

    everything = administrator.get("/api/admin/audit/")
    assert [e["action"] for e in everything.json()] == ["user.reset_password", "user.update"]
    assert everything["X-Total-Count"] == "2"
    assert len(administrator.get("/api/admin/audit/?action=user.upd").json()) == 1
    assert len(administrator.get(f"/api/admin/audit/?actor={actor.pk}").json()) == 2
    assert len(administrator.get("/api/admin/audit/?actor=admin@").json()) == 2
    assert administrator.get("/api/admin/audit/?actor=nobody").json() == []
    assert len(administrator.get("/api/admin/audit/?limit=1").json()) == 1


def test_roles_are_listed_and_only_role_managers_change_them(support: APIClient) -> None:
    roles = {r["name"]: r["permissions"] for r in support.get("/api/admin/roles/").json()}
    assert roles["Support"] == ["users.manage", "users.view"]
    assert support.post("/api/admin/roles/", {}, format="json").status_code == 403

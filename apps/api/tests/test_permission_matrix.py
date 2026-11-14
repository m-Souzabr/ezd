"""One table says which permission each Control Panel route needs. Three checks hold to it.

1. Every `admin-*` route and method has a row, so a new route without a permission fails here.
2. The permission a view declares is the one in the table.
3. Each role gets through exactly the rows it holds a permission for, and nobody else does.
"""

import pytest
from django.urls import URLPattern, URLResolver, get_resolver, reverse
from rest_framework.test import APIClient

from accounts.models import User
from controlpanel.codes import (
    ALL_CODES,
    APP_EDIT,
    AUDIT_VIEW,
    CATALOG_EDIT,
    CATALOG_PUBLISH,
    LLM_EDIT,
    QUOTE_EDIT,
    ROLES_MANAGE,
    RULES_EDIT,
    USERS_MANAGE,
    USERS_VIEW,
)
from controlpanel.permissions import permissions_of

from .test_controlpanel import staff_with

ANY_SECTION = (APP_EDIT, RULES_EDIT, QUOTE_EDIT)
ANY_CONFIG = (*ANY_SECTION, CATALOG_EDIT)

# (route name, method, the codes of which holding any one is enough, URL arguments)
TABLE: list[tuple[str, str, str | tuple[str, ...], list[object]]] = [
    ("admin-user-list", "get", USERS_VIEW, []),
    ("admin-user-list", "post", USERS_MANAGE, []),
    ("admin-user-detail", "get", USERS_VIEW, ["@user"]),
    ("admin-user-detail", "patch", USERS_MANAGE, ["@user"]),
    ("admin-user-reset-password", "post", USERS_MANAGE, ["@user"]),
    ("admin-role-list", "get", USERS_VIEW, []),
    ("admin-role-list", "post", ROLES_MANAGE, []),
    ("admin-role-detail", "patch", ROLES_MANAGE, [987654]),
    ("admin-role-detail", "delete", ROLES_MANAGE, [987654]),
    ("admin-audit-list", "get", AUDIT_VIEW, []),
    ("admin-audit-export", "get", AUDIT_VIEW, []),
    ("admin-audit-types", "get", AUDIT_VIEW, []),
    ("admin-config-draft", "get", ANY_SECTION, []),
    ("admin-config-draft", "put", ANY_SECTION, []),
    ("admin-config-publish", "post", ANY_SECTION, []),
    ("admin-config-versions", "get", ANY_SECTION, []),
    ("admin-config-rollback", "post", ANY_SECTION, [987654]),
    ("admin-config-export", "get", ANY_CONFIG, []),
    ("admin-config-import", "post", ANY_CONFIG, []),
    ("admin-config-reset", "post", ANY_CONFIG, []),
    ("admin-config-dry-run", "post", ANY_SECTION, []),
    ("admin-config-version-diff", "get", ANY_SECTION, []),
    ("admin-catalog-draft", "get", CATALOG_EDIT, []),
    ("admin-catalog-draft", "put", CATALOG_EDIT, []),
    ("admin-catalog-validate", "post", CATALOG_EDIT, []),
    ("admin-catalog-publish", "post", CATALOG_PUBLISH, []),
    ("admin-catalog-versions", "get", CATALOG_EDIT, []),
    ("admin-catalog-rollback", "post", CATALOG_PUBLISH, ["nope"]),
    ("admin-catalog-dry-run", "post", CATALOG_PUBLISH, []),
    ("admin-catalog-version-diff", "get", CATALOG_EDIT, []),
    ("admin-catalog-entry-list", "post", CATALOG_EDIT, []),
    ("admin-catalog-entry-detail", "patch", CATALOG_EDIT, ["nope"]),
    ("admin-catalog-entry-retire", "post", CATALOG_EDIT, ["nope"]),
    ("admin-catalog-entry-restore", "post", CATALOG_EDIT, ["nope"]),
    ("admin-catalog-finish-list", "post", CATALOG_EDIT, []),
    ("admin-catalog-finish-detail", "patch", CATALOG_EDIT, ["nope"]),
    ("admin-catalog-finish-retire", "post", CATALOG_EDIT, ["nope"]),
    ("admin-catalog-finish-restore", "post", CATALOG_EDIT, ["nope"]),
    ("llm-settings", "get", LLM_EDIT, []),
    ("llm-settings", "patch", LLM_EDIT, []),
]
BY_ROUTE = {(name, method): needs for name, method, needs, _ in TABLE}


def _routes(resolver: URLResolver | None = None) -> dict[tuple[str, str], type]:
    """Every `admin-*` route name and method the API serves, with its view class."""
    found: dict[tuple[str, str], type] = {}
    for entry in (resolver or get_resolver()).url_patterns:
        if isinstance(entry, URLResolver):
            found |= _routes(entry)
        elif isinstance(entry, URLPattern) and (entry.name or "").startswith(("admin-", "llm-")):
            view = entry.callback.cls  # type: ignore[attr-defined]
            for method in view.http_method_names:
                if method not in ("options", "head") and hasattr(view, method):
                    found[(entry.name, method)] = view
    return found


def _codes(needs: str | tuple[str, ...]) -> tuple[str, ...]:
    return (needs,) if isinstance(needs, str) else needs


def test_every_admin_route_and_method_has_a_row_in_the_table() -> None:
    served = {key for key in _routes() if key[0].startswith("admin-") or key[0] == "llm-settings"}
    assert served == set(BY_ROUTE), (
        "Add a row to TABLE for each new route (and remove the rows of removed ones): "
        f"{sorted(served ^ set(BY_ROUTE))}"
    )


def test_the_table_uses_only_known_permission_codes() -> None:
    for _, _, needs, _ in TABLE:
        assert set(_codes(needs)) <= set(ALL_CODES)


def test_each_view_declares_the_permission_the_table_says() -> None:
    for (name, method), view in _routes().items():
        declared = view.control_panel_perm  # type: ignore[attr-defined]
        declared = declared.get(method.upper()) if isinstance(declared, dict) else declared
        assert declared is not None, (name, method)
        assert set(_codes(declared)) == set(_codes(BY_ROUTE[(name, method)])), (name, method)


@pytest.mark.parametrize("role", ["Administrator", "Support", "Catalog editor", None])
def test_each_role_gets_through_exactly_the_rows_it_holds(role: str | None, user: User) -> None:
    api = staff_with(role, "staff@example.com")
    held = set(permissions_of(api.user))  # type: ignore[attr-defined]
    for name, method, needs, args in TABLE:
        resolved = [user.pk if arg == "@user" else arg for arg in args]
        status = getattr(api, method)(reverse(name, args=resolved), {}, format="json").status_code
        assert (status != 403) == bool(held & set(_codes(needs))), (role, name, method, status)


def test_a_non_staff_user_is_refused_and_anonymous_is_unauthorized(
    client: APIClient, anonymous: APIClient, user: User
) -> None:
    for name, method, _, args in TABLE:
        url = reverse(name, args=[user.pk if arg == "@user" else arg for arg in args])
        assert getattr(client, method)(url, {}, format="json").status_code == 403, (name, method)
        assert getattr(anonymous, method)(url, {}, format="json").status_code == 401, (name, method)

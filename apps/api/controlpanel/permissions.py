from typing import Any

from django.contrib.auth.models import Permission
from rest_framework.permissions import BasePermission
from rest_framework.request import Request

from .codes import ALL_CODES

APP_LABEL = "controlpanel"


def permissions_of(user: Any) -> list[str]:
    """The Control Panel codes the user holds. A superuser holds all of them."""
    if not user.is_authenticated or not user.is_active:
        return []
    if user.is_superuser:
        return list(ALL_CODES)
    held = {
        code.removeprefix(f"{APP_LABEL}.")
        for code in user.get_all_permissions()
        if code.startswith(f"{APP_LABEL}.")
    }
    return [code for code in ALL_CODES if code in held]


def can(user: Any, code: str) -> bool:
    return code in permissions_of(user)


def permission_rows(codes: tuple[str, ...] | list[str]) -> Any:
    return Permission.objects.filter(
        content_type__app_label=APP_LABEL, codename__in=codes
    ).order_by("codename")


class HasControlPanelPerm(BasePermission):
    """Staff holding the permission the view declares.

    A view sets `control_panel_perm` to a code, or to a dict from HTTP method to code (a
    method it does not list is refused). Either may be a tuple of codes, of which holding
    any one is enough. `is_staff` is the gate: a superuser who is not
    staff does not enter either.
    """

    def has_permission(self, request: Request, view: Any) -> bool:
        user = request.user
        if not (user.is_authenticated and user.is_staff):
            return False
        needed = view.control_panel_perm
        if isinstance(needed, dict):
            needed = needed.get(request.method)
        if needed is None:
            return False
        codes = (needed,) if isinstance(needed, str) else needed
        return any(can(user, code) for code in codes)

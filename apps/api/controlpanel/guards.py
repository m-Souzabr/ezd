"""Rules that keep the staff from locking themselves out. Used by the API and the Django admin."""

from typing import Any

from django.contrib.auth import get_user_model


class GuardError(Exception):
    pass


def active_superusers() -> Any:
    return get_user_model().objects.filter(is_active=True, is_superuser=True)


def check_change(
    actor: Any, target: Any, *, is_active: bool, is_superuser: bool, is_staff: bool
) -> None:
    """Raises `GuardError` if `actor` may not turn `target` into the given state."""
    if is_superuser and not target.is_superuser and not actor.is_superuser:
        raise GuardError("Only a superuser can make someone a superuser.")
    if target.is_superuser and not is_superuser and not actor.is_superuser:
        raise GuardError("Only a superuser can remove superuser access.")
    if actor.pk == target.pk:
        if target.is_active and not is_active:
            raise GuardError("You cannot deactivate your own account.")
        if target.is_superuser and not is_superuser:
            raise GuardError("You cannot remove your own superuser access.")
        if target.is_staff and not is_staff:
            raise GuardError("You cannot remove your own staff access.")
    if target.is_superuser and target.is_active and not (is_superuser and is_active):
        others = active_superusers().exclude(pk=target.pk)
        if not others.exists():
            raise GuardError("This is the last active superuser.")


def check_delete(actor: Any, target: Any) -> None:
    if actor.pk == target.pk:
        raise GuardError("You cannot delete your own account.")
    if target.is_superuser and target.is_active:
        if not active_superusers().exclude(pk=target.pk).exists():
            raise GuardError("This is the last active superuser.")


def check_delete_many(actor: Any, targets: Any) -> None:
    """Like `check_delete` for several accounts at once, which together may be the last ones."""
    ids = [target.pk for target in targets]
    if actor.pk in ids:
        raise GuardError("You cannot delete your own account.")
    removed = active_superusers().filter(pk__in=ids).exists()
    if removed and not active_superusers().exclude(pk__in=ids).exists():
        raise GuardError("This would delete the last active superuser.")

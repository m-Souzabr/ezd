"""The one helper every Control Panel mutation calls to write its audit entry."""

from typing import Any

from .models import AuditEntry

# A key with one of these words in its name is never stored, whatever it holds.
SECRET_WORDS = ("password", "api_key", "secret", "token", "encrypted")
REDACTED = "[redacted]"


def scrub(value: Any) -> Any:
    """A copy of `value` with the value of every secret-looking key replaced."""
    if isinstance(value, dict):
        return {
            key: REDACTED if any(word in str(key).lower() for word in SECRET_WORDS) else scrub(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [scrub(item) for item in value]
    return value


def record(
    actor: Any,
    action: str,
    object_type: str,
    object_id: object = "",
    *,
    before: Any = None,
    after: Any = None,
) -> AuditEntry:
    return AuditEntry.objects.create(
        actor=actor if getattr(actor, "pk", None) else None,
        actor_email=getattr(actor, "email", ""),
        action=action,
        object_type=object_type,
        object_id=str(object_id),
        before=scrub(before),
        after=scrub(after),
    )

"""What a 409 on a draft tells the person who lost: who saved it, and when."""

from typing import Any


def conflict_extra(draft: Any) -> dict[str, Any]:
    """The fields added to a stale-draft response. Empty when there is no draft any more."""
    if draft is None:
        return {}
    editor = draft.updated_by or draft.created_by
    return {
        "conflict": {
            "updated_by": editor.email if editor else "",
            "updated_at": draft.updated_at.isoformat(),
            "revision": draft.revision,
        }
    }

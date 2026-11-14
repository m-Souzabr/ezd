"""A readable difference between two JSON values, for the version history and the audit log."""

from typing import Any

# A string longer than this (a logo, say) is shown as its length, not its content.
LONG_STRING = 200
Change = dict[str, Any]


def _show(value: Any) -> Any:
    if isinstance(value, str) and len(value) > LONG_STRING:
        return f"<{len(value)} characters>"
    return value


def _keyed(items: Any) -> dict[str, Any] | None:
    """A list of objects that all have distinct string ids, by id; else None."""
    if not isinstance(items, list) or not items:
        return None
    if not all(isinstance(item, dict) and isinstance(item.get("id"), str) for item in items):
        return None
    ids = [item["id"] for item in items]
    return dict(zip(ids, items, strict=True)) if len(set(ids)) == len(ids) else None


def diff(before: Any, after: Any, path: str = "") -> list[Change]:
    """The changes that turn `before` into `after`, each with a path and both values.

    Objects are compared key by key, lists of objects with an `id` by id (so a reordered
    catalog is not a change of every entry), anything else as a whole.
    """
    if before == after:
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        changes: list[Change] = []
        for key in sorted(set(before) | set(after)):
            here = f"{path}.{key}" if path else str(key)
            if key not in before:
                changes.append({"path": here, "kind": "added", "after": _show(after[key])})
            elif key not in after:
                changes.append({"path": here, "kind": "removed", "before": _show(before[key])})
            else:
                changes += diff(before[key], after[key], here)
        return changes
    old, new = _keyed(before), _keyed(after)
    if old is not None and new is not None:
        changes = []
        for key in [*old, *(key for key in new if key not in old)]:
            here = f"{path}[{key}]"
            if key not in old:
                changes.append({"path": here, "kind": "added", "after": _show(new[key])})
            elif key not in new:
                changes.append({"path": here, "kind": "removed", "before": _show(old[key])})
            else:
                changes += diff(old[key], new[key], here)
        return changes
    return [
        {
            "path": path or "(whole)",
            "kind": "changed",
            "before": _show(before),
            "after": _show(after),
        }
    ]

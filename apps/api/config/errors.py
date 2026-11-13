"""A vendor-neutral hook for reporting unexpected errors.

`report_error(error, context)` calls the function named by the `ERROR_REPORTER` setting (a
dotted path), or does nothing when it is empty. Every unhandled exception in a request is
reported through it. See docs/OPERATIONS.md for an adapter. Never put design content,
photos, emails or keys in `context`: it may leave the server.
"""

import logging
import sys
from collections.abc import Callable
from functools import cache
from typing import Any

from django.conf import settings
from django.core.signals import got_request_exception
from django.utils.module_loading import import_string

logger = logging.getLogger("ezd.errors")

Reporter = Callable[[BaseException, dict[str, Any]], None]


@cache
def _reporter(path: str) -> Reporter | None:
    return import_string(path) if path else None


def report_error(error: BaseException, context: dict[str, Any] | None = None) -> None:
    """Reports the error. A reporter that fails is logged and ignored."""
    reporter = _reporter(settings.ERROR_REPORTER)
    if reporter is None:
        return
    try:
        reporter(error, context or {})
    except Exception:
        logger.exception("The error reporter failed")


def _on_request_exception(sender: Any, request: Any = None, **kwargs: Any) -> None:
    error = sys.exc_info()[1]
    if error is not None:
        context = {"method": getattr(request, "method", ""), "path": getattr(request, "path", "")}
        report_error(error, context)


got_request_exception.connect(_on_request_exception, dispatch_uid="ezd-report-error")

"""One JSON line per request: who, what, how long. Never a body, a cookie or a password."""

import json
import logging
import time
import uuid
from collections.abc import Callable
from typing import Any

from django.http import HttpRequest, HttpResponse

logger = logging.getLogger("ezd.request")

# The only attributes of a log record that are written, besides the message and level.
REQUEST_FIELDS = ("request_id", "method", "path", "status", "duration_ms", "user_id")
# And those of a call to the language model (`chat.services`). Never a key or a prompt.
LLM_FIELDS = (
    "model",
    "category",
    "input_tokens",
    "output_tokens",
    "cached_tokens",
    "latency_ms",
    "attempt",
    "outcome",
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in REQUEST_FIELDS + LLM_FIELDS:
            if hasattr(record, field):
                entry[field] = getattr(record, field)
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


class RequestLogMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        started = time.monotonic()
        request_id = uuid.uuid4().hex
        response = self.get_response(request)
        response["X-Request-Id"] = request_id
        user = getattr(request, "user", None)
        logger.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                # The path without its query string, which could carry a reset token.
                "path": request.path,
                "status": response.status_code,
                "duration_ms": round((time.monotonic() - started) * 1000, 1),
                "user_id": user.pk if user is not None and user.is_authenticated else None,
            },
        )
        return response

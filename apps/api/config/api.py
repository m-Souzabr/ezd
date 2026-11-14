"""Pieces every API view shares: authentication, body size limit, throttles and errors."""

import io
from collections.abc import Callable
from typing import Any

from django.conf import settings as django_settings
from django.core.exceptions import RequestDataTooBig
from django.http import HttpRequest, HttpResponse, JsonResponse
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import APIException
from rest_framework.parsers import JSONParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle

# The largest body a view reads, unless it sets `max_body_bytes`. This is what bounds the
# size of a stored document.
MAX_BODY_BYTES = 2 * 1024 * 1024


class SessionAuth(SessionAuthentication):
    """Session cookies with CSRF. Naming a scheme makes an anonymous request a 401, not a 403."""

    def authenticate_header(self, request: Request) -> str:
        return "Session"


class BodyTooLarge(APIException):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_code = "body_too_large"

    def __init__(self, max_bytes: int = MAX_BODY_BYTES) -> None:
        super().__init__(too_large_message(max_bytes))


def too_large_message(max_bytes: int) -> str:
    return f"The request body is larger than {max_bytes / (1024 * 1024):g} MB."


def body_limit(view: Any) -> int:
    """How large a body the view accepts. `view` is a view instance or class, or None."""
    return getattr(view, "max_body_bytes", MAX_BODY_BYTES)


class BodyLimitMiddleware:
    """Refuses a body that declares itself too large, before any of it is read.

    A body without a declared length is caught later: Django stops reading at
    `DATA_UPLOAD_MAX_MEMORY_SIZE`, and `LimitedJSONParser` checks what was read against the
    view's own limit. Either way the answer is a 413.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        return self.get_response(request)

    def process_view(
        self, request: HttpRequest, view_func: Any, view_args: Any, view_kwargs: Any
    ) -> HttpResponse | None:
        try:
            declared = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            declared = 0
        # DRF puts the view class on the function that `as_view` returns.
        limit = body_limit(getattr(view_func, "cls", None))
        if declared > limit:
            return JsonResponse({"detail": too_large_message(limit)}, status=413)
        return None


class LimitedJSONParser(JSONParser):
    def parse(self, stream: Any, media_type: Any = None, parser_context: Any = None) -> Any:
        limit = body_limit((parser_context or {}).get("view"))
        # DRF hands a JSON parser the whole body, already in memory.
        body = stream.read(limit + 1)
        if len(body) > limit:
            raise BodyTooLarge(limit)
        return super().parse(io.BytesIO(body), media_type, parser_context)


class _ScopedRateThrottle(SimpleRateThrottle):
    def get_rate(self) -> str | None:
        # Read on each request so a change of settings (as in tests) applies.
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)


class UserThrottle(UserRateThrottle):
    """The general limit: per signed-in user, or per IP address when anonymous."""

    scope = "user"

    def get_rate(self) -> str | None:
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)


class LLMThrottle(UserThrottle):
    """Calls to the language model, per signed-in user: each one costs money."""

    scope = "llm"


class UploadThrottle(UserThrottle):
    """Photo uploads, per signed-in user: each one is decoded and re-encoded on the server."""

    scope = "upload"


class PostThrottledMixin:
    """Adds `post_throttle` to a view's POST, the expensive request of the view."""

    request: Request
    post_throttle: type[UserThrottle]

    def get_throttles(self) -> list[Any]:
        throttles = list(super().get_throttles())
        if self.request.method == "POST":
            throttles.append(self.post_throttle())
        return throttles


class LLMThrottledMixin(PostThrottledMixin):
    """A view whose POST calls the language model."""

    post_throttle = LLMThrottle


class UploadThrottledMixin(PostThrottledMixin):
    post_throttle = UploadThrottle


class AdminThrottle(UserThrottle):
    """Every Control Panel route (`admin-*`), per signed-in user.

    It sits in the default throttles and lets other routes through, so a new admin route is
    limited without declaring anything.
    """

    scope = "admin"

    def allow_request(self, request: Request, view: Any) -> bool:
        match = getattr(request, "resolver_match", None) or getattr(
            request._request, "resolver_match", None
        )
        if not (match and (match.url_name or "").startswith("admin-")):
            return True
        return super().allow_request(request, view)


class LoginIpThrottle(_ScopedRateThrottle):
    scope = "login_ip"

    def get_cache_key(self, request: Request, view: Any) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class LoginEmailThrottle(_ScopedRateThrottle):
    scope = "login_email"

    def get_cache_key(self, request: Request, view: Any) -> str | None:
        email = request.data.get("email") if isinstance(request.data, dict) else None
        if not isinstance(email, str) or not email:
            return None
        return self.cache_format % {"scope": self.scope, "ident": email.strip().lower()}


class AuthIpThrottle(LoginIpThrottle):
    """Registration and password reset, per IP address."""

    scope = "auth_ip"


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """DRF's handler, plus the `errors` list of an invalid document."""
    # Imported here: DRF loads this module while `rest_framework.views` is still loading.
    from rest_framework.views import exception_handler as drf_exception_handler

    if isinstance(exc, RequestDataTooBig):
        # Past the largest body any view accepts, so Django stopped reading it.
        exc = BodyTooLarge(django_settings.DATA_UPLOAD_MAX_MEMORY_SIZE)
    response = drf_exception_handler(exc, context)
    errors = getattr(exc, "errors", None)
    if response is not None and isinstance(errors, list) and isinstance(response.data, dict):
        response.data["errors"] = errors
    extra = getattr(exc, "extra", None)
    if response is not None and isinstance(extra, dict) and isinstance(response.data, dict):
        response.data.update(extra)
    return response

"""Pieces every API view shares: authentication, body size limit, throttles and errors."""

from typing import Any

from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import APIException
from rest_framework.parsers import JSONParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle

# Every request body, which bounds the size of a stored document.
MAX_BODY_BYTES = 2 * 1024 * 1024


class SessionAuth(SessionAuthentication):
    """Session cookies with CSRF. Naming a scheme makes an anonymous request a 401, not a 403."""

    def authenticate_header(self, request: Request) -> str:
        return "Session"


class BodyTooLarge(APIException):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_detail = "The request body is larger than 2 MB."
    default_code = "body_too_large"


class _Limited:
    """Reads at most one byte more than the limit, so an oversized body is never held."""

    def __init__(self, stream: Any) -> None:
        self._stream = stream

    def read(self, *args: Any) -> bytes:
        data = self._stream.read(MAX_BODY_BYTES + 1)
        if len(data) > MAX_BODY_BYTES:
            raise BodyTooLarge()
        return data


class LimitedJSONParser(JSONParser):
    def parse(self, stream: Any, media_type: Any = None, parser_context: Any = None) -> Any:
        request = (parser_context or {}).get("request")
        try:
            declared = int(request.META.get("CONTENT_LENGTH") or 0) if request else 0
        except ValueError:
            declared = 0
        if declared > MAX_BODY_BYTES:
            raise BodyTooLarge()
        return super().parse(_Limited(stream), media_type, parser_context)


class _ScopedRateThrottle(SimpleRateThrottle):
    def get_rate(self) -> str | None:
        # Read on each request so a change of settings (as in tests) applies.
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)


class UserThrottle(UserRateThrottle):
    """The general limit: per signed-in user, or per IP address when anonymous."""

    scope = "user"

    def get_rate(self) -> str | None:
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)


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

    response = drf_exception_handler(exc, context)
    errors = getattr(exc, "errors", None)
    if response is not None and isinstance(errors, list) and isinstance(response.data, dict):
        response.data["errors"] = errors
    return response

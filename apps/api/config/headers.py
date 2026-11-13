"""Security headers Django does not set by itself.

Django already sends `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options:
DENY` and, in production, HSTS. This adds a Content-Security-Policy: the API answers JSON
and images, which never need a script, a style or a frame; the admin gets its own files.
"""

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse

API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
ADMIN_CSP = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'"


class SecurityHeadersMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        csp = API_CSP if request.path.startswith("/api/") else ADMIN_CSP
        response.headers.setdefault("Content-Security-Policy", csp)
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        return response

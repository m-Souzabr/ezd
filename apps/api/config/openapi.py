"""Tells drf-spectacular how the API authenticates. Loaded by `config.apps`."""

from typing import Any

from drf_spectacular.extensions import OpenApiAuthenticationExtension


class SessionAuthScheme(OpenApiAuthenticationExtension):
    target_class = "config.api.SessionAuth"
    name = "cookieAuth"
    priority = -1

    def get_security_definition(self, auto_schema: Any) -> dict[str, str]:
        return {"type": "apiKey", "in": "cookie", "name": "sessionid"}

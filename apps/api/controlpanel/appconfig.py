"""The app configuration: what is published, what is being edited, and how it is checked.

The shape of a configuration, its defaults and its rules live in core. The API runs
`ezd-core validate-config` for them, as it does for design documents, and so stores a
configuration with every default filled in.
"""

import base64
import binascii
import json
import subprocess
from typing import Any

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import APIException

from llm import config as llm_config

from .models import ConfigVersion

Issue = dict[str, str]
CLI_TIMEOUT_SECONDS = 10
MAX_LOGO_BYTES = 150_000
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_RGB = b"\x02"
JPEG_SIGNATURE = b"\xff\xd8\xff"
EMPTY_BRANDING = {
    "numberPrefix": "",
    "companyName": "",
    "address": "",
    "contact": "",
    "logo": "",
    "footerText": "",
}


class InvalidConfig(APIException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "The configuration is not valid."
    default_code = "invalid_config"

    def __init__(self, errors: list[Issue]) -> None:
        super().__init__()
        self.errors = errors


class ConfigValidationUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The configuration cannot be validated right now."
    default_code = "validation_unavailable"


class StaleDraft(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The draft was changed by someone else. Reload it and try again."
    default_code = "stale_draft"


def _run_core(command: str, config: Any) -> dict[str, Any]:
    """One `ezd-core` validation of a section. Raises `ConfigValidationUnavailable`."""
    try:
        result = subprocess.run(
            [*settings.EZD_CORE_CLI, command],
            input=json.dumps(config),
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT_SECONDS,
            check=False,
        )
        output = json.loads(result.stdout)
        if output["ok"] != (result.returncode == 0):
            raise ValueError("unexpected ezd-core output")
        if "errors" not in output or "config" not in output:
            raise ValueError("unexpected ezd-core output")
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise ConfigValidationUnavailable() from error
    return output


def _checked(command: str, config: Any, prefix: str = "") -> dict[str, Any]:
    output = _run_core(command, config)
    if not output["ok"]:
        raise InvalidConfig(
            [
                {
                    "path": prefix + str(issue["path"]),
                    "message": str(issue["message"]),
                }
                for issue in output["errors"]
            ]
        )
    return output["config"]


def validate_config(config: Any) -> dict[str, Any]:
    """The app configuration with its defaults filled in, or raises `InvalidConfig`."""
    return _checked("validate-config", config)


def validate_rules_config(config: Any) -> dict[str, Any]:
    """The rules configuration with its defaults filled in, or raises `InvalidConfig`.

    Core refuses a locked rule that is off or lowered, and a threshold out of its range.
    """
    return _checked("validate-rules-config", config)


def _check_logo(logo: str) -> None:
    """A logo is a JPEG, or a PNG with no alpha channel, so the PDF is the same every time."""
    problem = None
    try:
        encoded = logo.split(",", 1)[1]
        image = base64.b64decode(encoded, validate=True)
    except (IndexError, binascii.Error, ValueError):
        problem = "The logo is not valid base64."
    else:
        if len(image) > MAX_LOGO_BYTES:
            problem = "The logo is larger than 150 KB."
        elif logo.startswith("data:image/png"):
            is_png = image.startswith(PNG_SIGNATURE) and image[12:16] == b"IHDR"
            if not is_png:
                problem = "The logo is not a PNG image."
            elif image[25:26] != PNG_RGB:
                problem = "The logo is an RGB PNG without an alpha channel, or a JPEG."
        elif not image.startswith(JPEG_SIGNATURE):
            problem = "The logo is not a JPEG image."
    if problem:
        raise InvalidConfig([{"path": "branding.logo", "message": problem}])


def validate_quote_defaults(config: Any) -> dict[str, Any]:
    """The quote defaults with their defaults filled in, or raises `InvalidConfig`."""
    filled = _checked("validate-quote-defaults", config)
    if filled["branding"]["logo"]:
        _check_logo(filled["branding"]["logo"])
    return filled


def published() -> ConfigVersion | None:
    return ConfigVersion.objects.filter(status=ConfigVersion.Status.PUBLISHED).first()


def draft() -> ConfigVersion | None:
    return ConfigVersion.objects.filter(status=ConfigVersion.Status.DRAFT).first()


def published_config() -> dict[str, Any]:
    """What the app uses. Without a row it is `{}`, which clients read as the defaults."""
    row = published()
    return row.app_config if row else {}


def flag(section: str, name: str, default: bool = True) -> bool:
    """One published feature flag, for the server's own checks."""
    value = published_config().get(section, {}).get(name, default)
    return value if isinstance(value, bool) else default


def effective(config: dict[str, Any]) -> dict[str, Any]:
    """The published configuration as the app is served it.

    The assistant is on only if its flag is on and a key is configured.
    """
    features = {**config.get("features", {})}
    features["assistant"] = bool(features.get("assistant", True)) and llm_config.is_configured()
    return {**config, "features": features}


def published_rules() -> dict[str, Any]:
    """What the checks use. Without a row it is `{}`, which core reads as the defaults."""
    row = published()
    return row.rules_config if row else {}


def published_quote_defaults() -> dict[str, Any]:
    row = published()
    return row.quote_defaults if row else {}


def branding_snapshot() -> dict[str, str]:
    """The branding a new quote keeps: what is published now, so the quote never changes."""
    return {**EMPTY_BRANDING, **published_quote_defaults().get("branding", {})}


def public_quote_defaults(defaults: dict[str, Any]) -> dict[str, Any]:
    """The quote defaults the browser needs: the rates, without the logo, which can be large.

    The server snapshots the branding into each quote, so the editor never reads the logo.
    """
    branding = defaults.get("branding")
    if not branding or "logo" not in branding:
        return defaults
    return {**defaults, "branding": {**branding, "logo": ""}}

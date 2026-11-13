"""The app configuration: what is published, what is being edited, and how it is checked.

The shape of a configuration, its defaults and its rules live in core. The API runs
`ezd-core validate-config` for them, as it does for design documents, and so stores a
configuration with every default filled in.
"""

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


def validate_config(config: Any) -> dict[str, Any]:
    """The configuration with its defaults filled in, or raises `InvalidConfig`."""
    try:
        result = subprocess.run(
            [*settings.EZD_CORE_CLI, "validate-config"],
            input=json.dumps(config),
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT_SECONDS,
            check=False,
        )
        output = json.loads(result.stdout)
        if output["ok"] != (result.returncode == 0):
            raise ValueError("unexpected ezd-core output")
        errors = output["errors"]
        filled = output["config"]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise ConfigValidationUnavailable() from error
    if not output["ok"]:
        raise InvalidConfig(
            [{"path": str(issue["path"]), "message": str(issue["message"])} for issue in errors]
        )
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

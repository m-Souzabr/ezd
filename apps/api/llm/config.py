"""Which client, key and models the assistant uses.

The vendor is `LLM_VENDOR`, one of the keys of `LLM_CLIENTS`. The API key and the model
names entered by staff in AI settings take precedence over the environment.
"""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

from django.conf import settings
from django.utils.module_loading import import_string
from rest_framework import status
from rest_framework.exceptions import APIException

from .client import LLMClient
from .fake import FakeClient, ScriptedFakeClient
from .models import LLMSettings
from .secrets import UndecryptableSecret, decrypt


class LLMNotConfigured(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "The assistant is not set up yet. An administrator can add an API key in AI settings."
    )
    default_code = "llm_not_configured"


@dataclass(frozen=True)
class Models:
    router: str
    default: str
    escalation: str


KeySource = Literal["settings", "environment", "none"]


def models() -> Models:
    row = LLMSettings.load()
    return Models(
        router=row.router_model or settings.LLM_ROUTER_MODEL,
        default=row.default_model or settings.LLM_DEFAULT_MODEL,
        escalation=row.escalation_model or settings.LLM_ESCALATION_MODEL,
    )


def api_key() -> tuple[str, KeySource]:
    """The key the client uses, and where it comes from. Never log or return the key."""
    row = LLMSettings.load()
    if row.encrypted_api_key:
        try:
            return decrypt(row.encrypted_api_key), "settings"
        except UndecryptableSecret:
            pass
    if settings.LLM_API_KEY:
        return settings.LLM_API_KEY, "environment"
    return "", "none"


# The one fake every request shares when `LLM_VENDOR` is "fake". Tests script it.
_fake = FakeClient()


def fake_client() -> FakeClient:
    return _fake


def set_fake_client(client: FakeClient) -> None:
    global _fake
    _fake = client


@cache
def _scripted(path: str) -> ScriptedFakeClient:
    return ScriptedFakeClient(json.loads(Path(path).read_text(encoding="utf-8")))


def get_client() -> LLMClient:
    vendor = settings.LLM_VENDOR
    if vendor == "fake":
        return _scripted(settings.LLM_FAKE_SCRIPT) if settings.LLM_FAKE_SCRIPT else _fake
    key, _ = api_key()
    if not key:
        raise LLMNotConfigured()
    client_class = import_string(settings.LLM_CLIENTS[vendor])
    return client_class(api_key=key, timeout_seconds=settings.LLM_TIMEOUT_SECONDS)

"""The vendor client, the stored API key and the AI settings page."""

import json
import logging
from types import SimpleNamespace
from typing import Any

import httpx2 as httpx
import openai
import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from chat.services import AttemptInput, run_attempt
from llm import config, secrets
from llm.client import LLMUnavailable, ProposeRequest, ProposeResponse, ToolCall
from llm.config import LLMNotConfigured, Models
from llm.fake import FakeClient, ScriptedFakeClient, response_from_json, response_to_json
from llm.models import LLMSettings
from llm.openai_client import OpenAIClient, _parse, build_request
from llm.prompt import check_tool_calls, tools

KEY = "sk-test-0123456789abcdefWXYZ"
MODELS = Models(router="router-model", default="default-model", escalation="top-model")


@pytest.fixture
def staff(db: None) -> APIClient:
    user = User.objects.create_user(email="admin@example.com", password="x", is_staff=True)
    api = APIClient()
    api.force_login(user)
    return api


# --- the stored key -------------------------------------------------------------------


def test_the_key_is_encrypted_and_decrypts_back(settings: Any) -> None:
    token = secrets.encrypt(KEY)
    assert KEY not in token
    assert token != secrets.encrypt(KEY)  # A fresh nonce each time.
    assert secrets.decrypt(token) == KEY
    settings.SECRET_KEY = "another-secret"
    with pytest.raises(secrets.UndecryptableSecret):
        secrets.decrypt(token)
    with pytest.raises(secrets.UndecryptableSecret):
        secrets.decrypt("v0:abc")


def test_an_explicit_encryption_key_must_be_32_bytes(settings: Any) -> None:
    settings.LLM_SECRET_KEY = "c2hvcnQ="
    with pytest.raises(ValueError):
        secrets.encrypt(KEY)
    settings.LLM_SECRET_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    assert secrets.decrypt(secrets.encrypt(KEY)) == KEY


@pytest.mark.django_db
def test_the_stored_key_wins_over_the_environment(settings: Any) -> None:
    settings.LLM_API_KEY = "sk-from-env"
    assert config.api_key() == ("sk-from-env", "environment")
    row = LLMSettings.load()
    row.encrypted_api_key = secrets.encrypt(KEY)
    row.save()
    assert config.api_key() == (KEY, "settings")
    # A key that no longer decrypts falls back to the environment.
    settings.SECRET_KEY = "rotated"
    assert config.api_key() == ("sk-from-env", "environment")
    settings.LLM_API_KEY = ""
    assert config.api_key() == ("", "none")


@pytest.mark.django_db
def test_the_client_needs_a_key(settings: Any) -> None:
    settings.LLM_VENDOR = "openai"
    settings.LLM_API_KEY = ""
    with pytest.raises(LLMNotConfigured):
        config.get_client()
    settings.LLM_API_KEY = KEY
    assert isinstance(config.get_client(), OpenAIClient)


# --- the AI settings page -------------------------------------------------------------


def test_staff_set_the_key_and_never_see_it_again(staff: APIClient) -> None:
    response = staff.patch("/api/llm/settings/", {"api_key": KEY, "default_model": " gpt-x "})
    assert response.status_code == 200
    body = response.json()
    assert KEY not in json.dumps(body)
    assert body["api_key_last4"] == "WXYZ"
    assert body["configured"] is True
    assert body["key_source"] == "settings"
    assert body["models"]["default"] == "gpt-x"
    assert body["default_models"]["default"] == "gpt-5.4-mini"

    row = LLMSettings.load()
    assert KEY not in row.encrypted_api_key
    assert secrets.decrypt(row.encrypted_api_key) == KEY
    assert KEY not in json.dumps(staff.get("/api/llm/settings/").json())


def test_staff_remove_the_key_and_restore_default_models(staff: APIClient) -> None:
    staff.patch("/api/llm/settings/", {"api_key": KEY, "router_model": "tiny"})
    body = staff.patch("/api/llm/settings/", {"api_key": "", "router_model": ""}).json()
    assert body["api_key_last4"] == ""
    assert body["key_source"] == "none"
    assert body["models"]["router"] == "gpt-5.4-nano"


def test_a_key_with_spaces_is_refused(staff: APIClient) -> None:
    response = staff.patch("/api/llm/settings/", {"api_key": "sk bad"})
    assert response.status_code == 400


def test_only_staff_reach_the_settings(client: APIClient, anonymous: APIClient) -> None:
    assert client.get("/api/llm/settings/").status_code == 403
    assert client.patch("/api/llm/settings/", {"api_key": KEY}).status_code == 403
    assert anonymous.get("/api/llm/settings/").status_code == 401
    assert not LLMSettings.objects.exclude(encrypted_api_key="").exists()


def test_the_key_is_not_logged(staff: APIClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG):
        staff.patch("/api/llm/settings/", {"api_key": KEY})
    assert KEY not in caplog.text


# --- the OpenAI client ------------------------------------------------------------------


def _request(summary: str) -> ProposeRequest:
    fake = FakeClient([ProposeResponse(text="", tool_calls=[], stop_reason="completed")])
    run_attempt(fake, MODELS, AttemptInput(message="Add a base", summary=summary, category="x"))
    return fake.requests[0]


def test_the_cached_prefix_is_identical_across_designs() -> None:
    first = build_request(_request("Wall A: length 144"))
    second = build_request(_request("Wall A: length 96\nWall B: length 120"))
    prefix = lambda kwargs: json.dumps([kwargs["tools"], kwargs["input"][0]])  # noqa: E731
    assert prefix(first) == prefix(second)
    assert first["input"][1] != second["input"][1]
    # System prompt, then the catalog, ahead of anything that changes.
    assert first["input"][0]["role"] == "developer"
    assert "base.standard" in first["input"][0]["content"]
    assert first["prompt_cache_key"] == second["prompt_cache_key"]
    assert first["store"] is False


def test_a_forced_tool_is_requested_by_name() -> None:
    request = _request("Wall A")
    forced = ProposeRequest(**{**vars(request), "tool_choice": "ask_user"})
    assert build_request(forced)["tool_choice"] == {"type": "function", "name": "ask_user"}
    assert "tool_choice" not in build_request(request)


def test_a_response_is_parsed_into_text_calls_and_usage() -> None:
    response = SimpleNamespace(
        output=[
            SimpleNamespace(type="reasoning"),
            SimpleNamespace(
                type="message",
                content=[SimpleNamespace(type="output_text", text="Adding it.")],
            ),
            SimpleNamespace(type="function_call", name="remove_item", arguments='{"item":"c1"}'),
        ],
        usage=SimpleNamespace(
            input_tokens=1200,
            output_tokens=40,
            input_tokens_details=SimpleNamespace(cached_tokens=1024),
        ),
        status="completed",
        incomplete_details=None,
        model="gpt-5.4-mini-2026",
    )
    parsed = _parse(response)
    assert parsed.text == "Adding it."
    assert parsed.tool_calls == [ToolCall("remove_item", '{"item":"c1"}')]
    assert parsed.usage.cached_tokens == 1024
    assert parsed.stop_reason == "completed"
    assert parsed.model == "gpt-5.4-mini-2026"

    cut = SimpleNamespace(
        output=None,
        usage=None,
        status="incomplete",
        incomplete_details=SimpleNamespace(reason="max_output_tokens"),
        model=None,
    )
    assert _parse(cut).stop_reason == "max_output_tokens"


_HTTP = httpx.Request("POST", "https://api.openai.com/v1/responses")


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (openai.APITimeoutError(request=_HTTP), "took too long"),
        (
            openai.AuthenticationError(
                "bad key", response=httpx.Response(401, request=_HTTP), body=None
            ),
            "API key was refused",
        ),
        (
            openai.NotFoundError(
                "no model", response=httpx.Response(404, request=_HTTP), body=None
            ),
            "model default-model is not available",
        ),
        (
            openai.RateLimitError("slow", response=httpx.Response(429, request=_HTTP), body=None),
            "busy",
        ),
        (openai.APIConnectionError(request=_HTTP), "could not be reached"),
    ],
)
def test_vendor_errors_become_friendly_failures(
    monkeypatch: pytest.MonkeyPatch, error: Exception, message: str
) -> None:
    client = OpenAIClient(api_key=KEY, timeout_seconds=1)

    def fail(**kwargs: Any) -> None:
        raise error

    monkeypatch.setattr(client._client.responses, "create", fail)
    with pytest.raises(LLMUnavailable, match=message) as raised:
        client.propose(_request("Wall A"))
    assert KEY not in str(raised.value)


def test_a_successful_call_is_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    client = OpenAIClient(api_key=KEY, timeout_seconds=1)
    response = SimpleNamespace(
        output=[], usage=None, status="completed", incomplete_details=None, model="m"
    )
    monkeypatch.setattr(client._client.responses, "create", lambda **kwargs: response)
    assert client.propose(_request("Wall A")).stop_reason == "completed"


# --- tools and recordings -------------------------------------------------------------


def test_the_tools_come_from_core() -> None:
    names = [tool.name for tool in tools()]
    assert names[0] == "add_item" and names[-1] == "ask_user"


def test_valid_calls_pass_the_schema_check() -> None:
    calls = [
        ToolCall(
            "add_item",
            json.dumps({"catalogId": "filler.base", "widthIn": 1.5, "wall": "A", "offsetIn": 0}),
        ),
        ToolCall("generate_countertops", "{}"),
    ]
    checked, errors = check_tool_calls(calls)
    assert errors == []
    assert [call.name for call in checked] == ["add_item", "generate_countertops"]


def test_a_schema_error_names_the_field_of_the_entry() -> None:
    _, errors = check_tool_calls(
        [
            ToolCall(
                "add_item",
                json.dumps({"catalogId": "wall.standard", "widthIn": 30, "heightIn": 35}),
            )
        ]
    )
    assert errors[0].startswith("Tool call 1 (add_item): heightIn:")


def test_recordings_round_trip() -> None:
    data = {
        "text": "Hi",
        "tool_calls": [
            {"name": "remove_item", "arguments": {"item": "c1"}},
            {"name": "x", "arguments": "{oops"},
        ],
        "stop_reason": "completed",
        "usage": {"input_tokens": 1, "output_tokens": 2, "cached_tokens": 0},
        "model": "m",
    }
    assert response_to_json(response_from_json(data)) == data


def test_an_empty_fake_says_so() -> None:
    with pytest.raises(AssertionError, match="no response left"):
        FakeClient().propose(_request("Wall A"))


@override_settings(LLM_VENDOR="fake")
@pytest.mark.django_db
def test_the_fake_vendor_counts_as_configured(staff: APIClient) -> None:
    assert staff.get("/api/llm/settings/").json()["configured"] is True


def test_the_scripted_fake_answers_by_message(tmp_path: Any, settings: Any) -> None:
    script = {
        "Add a base": [
            {
                "tool_calls": [
                    {"name": "classify_request", "arguments": {"category": "simple_edit"}}
                ]
            },
            {"text": "Added.", "tool_calls": [{"name": "generate_countertops", "arguments": {}}]},
        ]
    }
    path = tmp_path / "script.json"
    path.write_text(json.dumps(script))
    settings.LLM_VENDOR = "fake"
    settings.LLM_FAKE_SCRIPT = str(path)
    client = config.get_client()
    assert isinstance(client, ScriptedFakeClient)
    result = run_attempt(client, MODELS, AttemptInput(message="Add a base", summary="Wall A"))
    assert result.category == "simple_edit"
    assert result.tool_calls == [{"name": "generate_countertops", "arguments": {}}]
    other = run_attempt(client, MODELS, AttemptInput(message="Hello", summary="", category="x"))
    assert other.text == "(No scripted answer for this message.)"

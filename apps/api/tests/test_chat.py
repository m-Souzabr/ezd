"""The chat endpoints, with the assistant scripted through `FakeClient`."""

import json
import logging
from typing import Any

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from chat.models import Message, Usage
from chat.services import OFF_TOPIC_REPLY
from llm.client import LLMUnavailable, ProposeResponse, ToolCall
from llm.client import Usage as TokenUsage
from llm.fake import FakeClient
from projects.models import Design

SUMMARY = "Wall A: length 144\n  free at base height (0-34.5): 0-144"
ADD_BASE = {"catalogId": "base.standard", "widthIn": 30, "wall": "A", "offsetIn": 0}


def classified(category: str) -> ProposeResponse:
    return ProposeResponse(
        text="",
        tool_calls=[ToolCall("classify_request", json.dumps({"category": category}))],
        stop_reason="completed",
        usage=TokenUsage(input_tokens=50, output_tokens=5),
    )


def answer(*calls: tuple[str, Any], text: str = "Done.") -> ProposeResponse:
    return ProposeResponse(
        text=text,
        tool_calls=[
            ToolCall(name, args if isinstance(args, str) else json.dumps(args))
            for name, args in calls
        ],
        stop_reason="completed",
        usage=TokenUsage(input_tokens=1000, output_tokens=100, cached_tokens=800),
    )


def send(client: APIClient, design: Design, message: str = "Add a 30 inch base on wall A", **extra):
    return client.post(
        f"/api/designs/{design.id}/chat/", {"message": message, "summary": SUMMARY, **extra}
    )


def retry(client: APIClient, message_id: str, errors: list[str] | None = None):
    return client.post(
        f"/api/chat/messages/{message_id}/retry/",
        {"errors": errors or ['Width 31" is not allowed'], "summary": SUMMARY},
    )


def test_a_valid_proposal_is_returned_and_not_applied(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(classified("simple_edit"), answer(("add_item", ADD_BASE)))
    document_before = design.draft_document

    response = send(client, design)

    assert response.status_code == 200
    body = response.json()
    assert body["tool_calls"] == [{"name": "add_item", "arguments": ADD_BASE}]
    assert body["errors"] == [] and body["question"] == ""
    assert body["attempt"] == 0 and body["retries_left"] == 2
    message = Message.objects.get(pk=body["message_id"])
    assert message.status == Message.Status.PROPOSED
    assert message.cached_tokens == 800
    design.refresh_from_db()
    assert design.draft_document == document_before
    # A simple edit stays on the router model.
    assert [r.model for r in fake_llm.requests] == ["gpt-5.4-nano", "gpt-5.4-nano"]


def test_a_complex_edit_uses_the_default_model(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(classified("complex_edit"), answer(("generate_countertops", {})))
    assert send(client, design, "Plan the whole wall").status_code == 200
    assert fake_llm.requests[1].model == "gpt-5.4-mini"


def test_a_malformed_tool_call_drops_the_whole_proposal(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(
        classified("simple_edit"),
        answer(("add_item", ADD_BASE), ("add_item", {**ADD_BASE, "widthIn": 31})),
    )
    body = send(client, design).json()
    assert body["tool_calls"] == []
    assert len(body["errors"]) == 1
    assert "Tool call 2 (add_item): widthIn" in body["errors"][0]
    assert "multiple of 3" in body["errors"][0]
    assert Message.objects.get(pk=body["message_id"]).status == Message.Status.INVALID


@pytest.mark.parametrize(
    ("call", "expected"),
    [
        (("paint_it", {}), "there is no such tool"),
        (("remove_item", "{not json"), "not valid JSON"),
        (("remove_item", "[1]"), "must be a JSON object"),
        (("add_item", {**ADD_BASE, "catalogId": "base.mystery"}), "'base.mystery' is not in"),
        (("remove_item", {"item": "cabinet"}), "item"),
    ],
)
def test_every_kind_of_malformed_call_is_reported(
    client: APIClient, design: Design, fake_llm: FakeClient, call: tuple, expected: str
) -> None:
    fake_llm.add(classified("simple_edit"), answer(call))
    body = send(client, design).json()
    assert body["tool_calls"] == []
    assert expected in body["errors"][0]


def test_ask_user_is_a_question_with_no_proposal(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(
        classified("simple_edit"),
        answer(("ask_user", {"question": "Which wall?"}), ("add_item", ADD_BASE), text=""),
    )
    body = send(client, design).json()
    assert body["question"] == "Which wall?"
    assert body["tool_calls"] == []
    assert Message.objects.get(pk=body["message_id"]).status == Message.Status.NONE


def test_an_off_topic_message_gets_a_short_reply_without_a_second_call(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(classified("off_topic"))
    body = send(client, design, "Write me a poem").json()
    assert body["text"] == OFF_TOPIC_REPLY
    assert len(fake_llm.requests) == 1


def test_retries_are_limited_and_only_the_last_one_escalates(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(
        classified("simple_edit"),
        answer(("add_item", ADD_BASE)),
        answer(("add_item", ADD_BASE)),
        answer(("add_item", ADD_BASE)),
    )
    first = send(client, design).json()
    second = retry(client, first["message_id"]).json()
    assert second["attempt"] == 1 and second["retries_left"] == 1
    third = retry(client, second["message_id"], ["Overlaps c1"]).json()
    assert third["attempt"] == 2 and third["retries_left"] == 0

    assert [r.model for r in fake_llm.requests] == [
        "gpt-5.4-nano",
        "gpt-5.4-nano",
        "gpt-5.4-mini",
        "gpt-5.5",
    ]
    # The retry tells the model what failed.
    last = fake_llm.requests[-1].messages
    assert "Overlaps c1" in last[-1].content
    assert last[-2].role == "assistant" and "add_item" in last[-2].content

    response = retry(client, third["message_id"])
    assert response.status_code == 409
    assert Message.objects.get(pk=first["message_id"]).status == Message.Status.INVALID


def test_an_attempt_is_retried_once_only(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(classified("simple_edit"), answer(("add_item", ADD_BASE)), answer())
    first = send(client, design).json()
    assert retry(client, first["message_id"]).status_code == 200
    assert retry(client, first["message_id"]).status_code == 409


def test_resolve_records_accept_and_reject_once(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(classified("simple_edit"), answer(("add_item", ADD_BASE)))
    message_id = send(client, design).json()["message_id"]
    url = f"/api/chat/messages/{message_id}/resolve/"
    response = client.post(url, {"status": "accepted"})
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    assert client.post(url, {"status": "rejected"}).status_code == 409
    assert client.post(url, {"status": "maybe"}).status_code == 400


def test_the_last_failed_attempt_can_be_marked_invalid(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(classified("simple_edit"), answer(("add_item", {"bad": 1})))
    message_id = send(client, design).json()["message_id"]
    url = f"/api/chat/messages/{message_id}/resolve/"
    assert client.post(url, {"status": "accepted"}).status_code == 409
    assert client.post(url, {"status": "invalid"}).status_code == 200


def test_history_sends_earlier_turns_and_a_short_line_for_older_ones(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    conversation_id = None
    with override_settings(LLM_HISTORY_TURNS=1):
        for text in ("First request", "Second request", "Third request"):
            fake_llm.add(classified("complex_edit"), answer(text=f"Reply to {text}"))
            body = send(client, design, text, conversation_id=conversation_id).json()
            conversation_id = body["conversation_id"]
    messages = fake_llm.requests[-1].messages
    assert [m.role for m in messages] == ["user", "assistant", "user"]
    assert messages[0].content == "Second request"
    assert messages[1].content == "Reply to Second request"
    assert 'Earlier requests in this conversation: "First request"' in messages[2].content
    assert SUMMARY in messages[2].content

    history = client.get(f"/api/designs/{design.id}/chat/").json()
    assert history["conversation_id"] == conversation_id
    assert [m["role"] for m in history["messages"]] == ["user", "assistant"] * 3


def test_an_empty_history(client: APIClient, design: Design) -> None:
    assert client.get(f"/api/designs/{design.id}/chat/").json() == {
        "conversation_id": None,
        "messages": [],
    }


def test_a_conversation_of_another_design_is_a_404(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    from .conftest import make_design

    fake_llm.add(classified("question"), answer(text="It has 4 walls."))
    conversation_id = send(client, design, "How many walls?").json()["conversation_id"]
    other = make_design(design.project, "Other")
    assert send(client, other, conversation_id=conversation_id).status_code == 404


def test_the_monthly_quota_is_enforced(
    client: APIClient, design: Design, user: Any, fake_llm: FakeClient
) -> None:
    with override_settings(LLM_MONTHLY_TOKEN_QUOTA=1100):
        fake_llm.add(classified("simple_edit"), answer(("add_item", ADD_BASE)))
        first = send(client, design)
        assert first.status_code == 200
        response = send(client, design)
        assert response.status_code == 429
        assert "allowance of 1,100 tokens" in response.json()["detail"]
        assert retry(client, first.json()["message_id"]).status_code == 429

        usage = client.get("/api/chat/usage/").json()
        assert usage["requests"] == 1
        assert usage["input_tokens"] == 1050
        assert usage["remaining_tokens"] == 0
    assert Usage.objects.get(user=user).output_tokens == 105


def test_message_and_summary_sizes_are_limited(client: APIClient, design: Design) -> None:
    with override_settings(LLM_MAX_MESSAGE_CHARS=10, LLM_MAX_SUMMARY_CHARS=20):
        response = send(client, design, "x" * 11)
        assert response.status_code == 400
        assert response.json()["message"] == ["The message is longer than 10 characters."]
        assert "summary" in response.json()


def test_a_vendor_failure_is_a_friendly_503_and_keeps_nothing(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(LLMUnavailable("The assistant took too long to answer. Try again."))
    response = send(client, design)
    assert response.status_code == 503
    assert response.json()["detail"] == "The assistant took too long to answer. Try again."
    assert not Message.objects.exists()


def test_a_cut_short_answer_is_a_failed_attempt(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(
        classified("simple_edit"),
        ProposeResponse(text="", tool_calls=[], stop_reason="max_output_tokens"),
    )
    body = send(client, design).json()
    assert body["errors"] == ["The answer was cut short (max_output_tokens). Make it shorter."]


def test_an_unreadable_router_answer_counts_as_a_complex_edit(
    client: APIClient, design: Design, fake_llm: FakeClient
) -> None:
    fake_llm.add(
        ProposeResponse(text="", tool_calls=[ToolCall("classify_request", "?")], stop_reason=""),
        answer(text="Hello"),
    )
    assert send(client, design).status_code == 200
    assert fake_llm.requests[1].model == "gpt-5.4-mini"


def test_every_call_is_logged_without_the_prompt(
    client: APIClient, design: Design, fake_llm: FakeClient, caplog: pytest.LogCaptureFixture
) -> None:
    fake_llm.add(classified("simple_edit"), answer(("add_item", ADD_BASE)))
    with caplog.at_level(logging.INFO, logger="ezd.llm"):
        send(client, design)
    [record] = [r for r in caplog.records if r.name == "ezd.llm"]
    assert record.model == "gpt-5.4-nano"
    assert record.input_tokens == 1050
    assert record.attempt == 0
    assert record.outcome == "proposed"
    assert SUMMARY not in record.getMessage()


@override_settings(LLM_VENDOR="openai", LLM_API_KEY="")
def test_an_unconfigured_assistant_is_a_503(client: APIClient, design: Design) -> None:
    response = send(client, design)
    assert response.status_code == 503
    assert "AI settings" in response.json()["detail"]

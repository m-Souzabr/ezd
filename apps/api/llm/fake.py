"""A client that answers from a script instead of a vendor, for tests and CI.

It returns the responses it was given, in order, and keeps every request it received. A
response can be an exception, which it raises instead. Photo analyses have a queue of their
own.
"""

import json
from collections.abc import Iterable
from typing import Any

from .client import PhotoRequest, PhotoResponse, ProposeRequest, ProposeResponse, ToolCall, Usage


def response_from_json(data: dict[str, Any]) -> ProposeResponse:
    """A response as the eval recordings store it: tool arguments as an object or a text."""
    return ProposeResponse(
        text=data.get("text", ""),
        tool_calls=[
            ToolCall(
                name=call["name"],
                arguments=call["arguments"]
                if isinstance(call["arguments"], str)
                else json.dumps(call["arguments"]),
            )
            for call in data.get("tool_calls", [])
        ],
        stop_reason=data.get("stop_reason", "completed"),
        usage=Usage(**data.get("usage", {})),
        model=data.get("model", ""),
    )


def response_to_json(response: ProposeResponse) -> dict[str, Any]:
    def arguments(text: str) -> Any:
        try:
            return json.loads(text)
        except ValueError:
            return text

    return {
        "text": response.text,
        "tool_calls": [
            {"name": call.name, "arguments": arguments(call.arguments)}
            for call in response.tool_calls
        ],
        "stop_reason": response.stop_reason,
        "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cached_tokens": response.usage.cached_tokens,
        },
        "model": response.model,
    }


def photo_response_from_json(data: dict[str, Any]) -> PhotoResponse:
    """A photo answer as the recordings store it: the draft as an object or a text."""
    draft = data.get("draft", data.get("text", ""))
    return PhotoResponse(
        text=draft if isinstance(draft, str) else json.dumps(draft),
        stop_reason=data.get("stop_reason", "completed"),
        usage=Usage(**data.get("usage", {})),
        model=data.get("model", ""),
    )


def photo_response_to_json(response: PhotoResponse) -> dict[str, Any]:
    try:
        draft: Any = json.loads(response.text)
    except ValueError:
        draft = response.text
    return {
        "draft": draft,
        "stop_reason": response.stop_reason,
        "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cached_tokens": response.usage.cached_tokens,
        },
        "model": response.model,
    }


class FakeClient:
    def __init__(
        self,
        responses: Iterable[ProposeResponse | Exception] = (),
        photo_responses: Iterable[PhotoResponse | Exception] = (),
    ) -> None:
        self.responses: list[ProposeResponse | Exception] = list(responses)
        self.requests: list[ProposeRequest] = []
        self.photo_responses: list[PhotoResponse | Exception] = list(photo_responses)
        self.photo_requests: list[PhotoRequest] = []

    def add(self, *responses: ProposeResponse | Exception) -> None:
        self.responses.extend(responses)

    def add_photo(self, *responses: PhotoResponse | Exception) -> None:
        self.photo_responses.extend(responses)

    def analyze_photo(self, request: PhotoRequest) -> PhotoResponse:
        self.photo_requests.append(request)
        if not self.photo_responses:
            raise AssertionError(f"FakeClient has no photo response left for {request.model}")
        response = self.photo_responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return PhotoResponse(
            text=response.text,
            stop_reason=response.stop_reason,
            usage=response.usage,
            model=response.model or request.model,
        )

    def propose(self, request: ProposeRequest) -> ProposeResponse:
        self.requests.append(request)
        if not self.responses:
            raise AssertionError(f"FakeClient has no response left for a call to {request.model}")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        # As a vendor would, answer with the model that was asked for.
        return ProposeResponse(
            text=response.text,
            tool_calls=response.tool_calls,
            stop_reason=response.stop_reason,
            usage=response.usage,
            model=response.model or request.model,
        )


# The key of the script's answer to every photo.
PHOTO_SCRIPT_KEY = "(photo)"


class ScriptedFakeClient:
    """Answers from a script keyed by the user's message, for the end-to-end tests, where the
    API runs in a process of its own. Each message has two responses: the router's, then
    the assistant's. Every photo gets the one answer under `PHOTO_SCRIPT_KEY`.
    """

    def __init__(self, script: dict[str, list[dict[str, Any]]]) -> None:
        self.script = script

    def propose(self, request: ProposeRequest) -> ProposeResponse:
        text = request.messages[-1].content
        for message, responses in self.script.items():
            if text.endswith(message):
                response = response_from_json(responses[0 if request.tool_choice else 1])
                return ProposeResponse(
                    text=response.text,
                    tool_calls=response.tool_calls,
                    stop_reason=response.stop_reason,
                    usage=response.usage,
                    model=request.model,
                )
        return ProposeResponse(
            text="(No scripted answer for this message.)", tool_calls=[], stop_reason="completed"
        )

    def analyze_photo(self, request: PhotoRequest) -> PhotoResponse:
        answers = self.script.get(PHOTO_SCRIPT_KEY)
        if not answers:
            return PhotoResponse(text="", stop_reason="completed", model=request.model)
        response = photo_response_from_json(answers[0])
        return PhotoResponse(
            text=response.text,
            stop_reason=response.stop_reason,
            usage=response.usage,
            model=request.model,
        )

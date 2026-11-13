"""The vendor-neutral interface to a language model.

Everything outside a vendor's own client module talks to an `LLMClient`. A vendor module
turns a `ProposeRequest` into its own API call and its answer back into a `ProposeResponse`.
"""

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

Role = Literal["user", "assistant"]


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ProposeRequest:
    """One call to the model.

    `system`, `tools` and `catalog_index` are the same on every request, in that order, so
    the vendor can cache them as one prefix. `messages` (the conversation and the document
    summary) follow them.
    """

    system: str
    catalog_index: str
    tools: list[ToolDefinition]
    messages: list[ChatMessage]
    model: str
    max_output_tokens: int
    # The name of a tool the model must call, or None to let it choose.
    tool_choice: str | None = None


@dataclass(frozen=True)
class ToolCall:
    name: str
    # The arguments as the model wrote them: a JSON text, not yet parsed or checked.
    arguments: str


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0


@dataclass(frozen=True)
class ProposeResponse:
    text: str
    tool_calls: list[ToolCall]
    # Why the model stopped: "completed", or the vendor's reason for an incomplete answer.
    stop_reason: str
    usage: Usage = field(default_factory=Usage)
    model: str = ""


class LLMUnavailable(Exception):
    """The vendor could not answer: a timeout, a network error, a refused key, an outage.

    The message is safe to show to the user. It never contains the API key.
    """


class LLMClient(Protocol):
    def propose(self, request: ProposeRequest) -> ProposeResponse: ...

"""OpenAI, through the official Python SDK and the Responses API.

The only module that knows about OpenAI. Prompt caching is automatic on OpenAI for a prefix
of 1024 tokens or more that is identical across requests; the request puts the system
prompt, the tools and the catalog index first, and names a `prompt_cache_key` so requests
that share the prefix are routed together.
"""

import base64
from typing import Any

import openai

from .client import (
    LLMUnavailable,
    PhotoRequest,
    PhotoResponse,
    ProposeRequest,
    ProposeResponse,
    ToolCall,
    Usage,
)

PROMPT_CACHE_KEY = "ezd-chat"
PHOTO_PROMPT_CACHE_KEY = "ezd-photo"
# Keywords strict structured output does not accept. The server checks the answer against
# the full schema afterwards, so leaving them out only loosens what the model is told.
UNSUPPORTED_SCHEMA_KEYWORDS = frozenset({"minLength", "maxLength", "title"})


def build_request(request: ProposeRequest) -> dict[str, Any]:
    """The keyword arguments of `responses.create` for a request. Pure, for the tests."""
    kwargs: dict[str, Any] = {
        "model": request.model,
        "tools": [
            {
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
                # Strict mode requires every property to be required, which the tools are
                # not. The server checks every call against the same schema instead.
                "strict": False,
            }
            for tool in request.tools
        ],
        "input": [
            {
                "role": "developer",
                "content": f"{request.system}\n\n{request.catalog_index}",
            },
            *({"role": m.role, "content": m.content} for m in request.messages),
        ],
        "max_output_tokens": request.max_output_tokens,
        "prompt_cache_key": PROMPT_CACHE_KEY,
        # Nothing is kept on OpenAI's side between requests; the server sends the history.
        "store": False,
    }
    if request.tool_choice is not None:
        kwargs["tool_choice"] = {"type": "function", "name": request.tool_choice}
    return kwargs


def strict_schema(schema: Any) -> Any:
    """The schema without the keywords strict structured output refuses."""
    if isinstance(schema, dict):
        return {
            # The keys of `properties` and `$defs` are names, not keywords.
            key: (
                {name: strict_schema(sub) for name, sub in value.items()}
                if key in ("properties", "$defs")
                else strict_schema(value)
            )
            for key, value in schema.items()
            if key not in UNSUPPORTED_SCHEMA_KEYWORDS
        }
    if isinstance(schema, list):
        return [strict_schema(value) for value in schema]
    return schema


def build_photo_request(request: PhotoRequest) -> dict[str, Any]:
    """The keyword arguments of `responses.create` for a photo. Pure, for the tests."""
    image = base64.b64encode(request.image).decode("ascii")
    return {
        "model": request.model,
        "input": [
            {"role": "developer", "content": request.system},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_image",
                        "image_url": f"data:{request.media_type};base64,{image}",
                        "detail": "high",
                    },
                    {"type": "input_text", "text": "Describe the kitchen in this photo."},
                ],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": request.schema_name,
                "schema": strict_schema(request.schema),
                "strict": True,
            }
        },
        "max_output_tokens": request.max_output_tokens,
        "prompt_cache_key": PHOTO_PROMPT_CACHE_KEY,
        "store": False,
    }


def _usage(response: Any) -> Usage:
    usage = response.usage
    details = getattr(usage, "input_tokens_details", None)
    return Usage(
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cached_tokens=getattr(details, "cached_tokens", 0) or 0,
    )


def _stop_reason(response: Any) -> str:
    incomplete = getattr(response, "incomplete_details", None)
    return getattr(incomplete, "reason", None) or response.status or "completed"


def _parse(response: Any) -> ProposeResponse:
    texts: list[str] = []
    calls: list[ToolCall] = []
    for item in response.output or []:
        if item.type == "function_call":
            calls.append(ToolCall(name=item.name, arguments=item.arguments or "{}"))
        elif item.type == "message":
            texts.extend(
                part.text
                for part in item.content or []
                if getattr(part, "type", "") == "output_text"
            )
    return ProposeResponse(
        text="\n".join(texts).strip(),
        tool_calls=calls,
        stop_reason=_stop_reason(response),
        usage=_usage(response),
        model=response.model or "",
    )


class OpenAIClient:
    def __init__(self, api_key: str, timeout_seconds: float) -> None:
        self._client = openai.OpenAI(api_key=api_key, timeout=timeout_seconds, max_retries=1)

    def propose(self, request: ProposeRequest) -> ProposeResponse:
        return _parse(self._create(build_request(request)))

    def analyze_photo(self, request: PhotoRequest) -> PhotoResponse:
        response = self._create(build_photo_request(request))
        return PhotoResponse(
            text=getattr(response, "output_text", "") or "",
            stop_reason=_stop_reason(response),
            usage=_usage(response),
            model=response.model or "",
        )

    def _create(self, kwargs: dict[str, Any]) -> Any:
        model = kwargs["model"]
        try:
            return self._client.responses.create(**kwargs)
        except openai.AuthenticationError as error:
            raise LLMUnavailable(
                "The assistant's API key was refused. "
                "An administrator can update it in AI settings."
            ) from error
        except openai.NotFoundError as error:
            raise LLMUnavailable(
                f"The model {model} is not available. An administrator can change it in "
                "AI settings."
            ) from error
        except openai.RateLimitError as error:
            raise LLMUnavailable(
                "The assistant is busy right now. Try again in a minute."
            ) from error
        except openai.APITimeoutError as error:
            raise LLMUnavailable("The assistant took too long to answer. Try again.") from error
        except openai.OpenAIError as error:
            raise LLMUnavailable("The assistant could not be reached. Try again.") from error

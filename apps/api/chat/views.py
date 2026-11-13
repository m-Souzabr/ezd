import uuid

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.api import LLMThrottledMixin
from controlpanel import catalogs
from llm import config
from llm.client import LLMClient, LLMUnavailable
from projects.models import Design
from projects.views import OwnedQuerysetMixin

from .models import Conversation, Message
from .serializers import (
    ChatRequestSerializer,
    ConversationSerializer,
    MessageSerializer,
    ProposalSerializer,
    ResolveRequestSerializer,
    RetryRequestSerializer,
    UsageSerializer,
)
from .services import MAX_RETRIES, AttemptInput, AttemptResult, Turn, run_attempt
from .usage import check_quota, record_usage, usage_for


class AssistantUnavailable(APIException):
    """The vendor failed. Nothing was proposed and the user may simply send again."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "assistant_unavailable"


class NoRetriesLeft(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This message has no retries left."
    default_code = "no_retries_left"


class NotPending(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This message has no pending proposal."
    default_code = "not_pending"


def _assistant_summary(message: Message | None) -> str:
    """How an earlier answer is replayed to the model."""
    if message is None:
        return ""
    parts = [message.text] if message.text else []
    if message.question:
        parts.append(f"(asked: {message.question})")
    if message.tool_calls:
        names = ", ".join(call["name"] for call in message.tool_calls)
        outcome = {
            Message.Status.ACCEPTED: "the user accepted it",
            Message.Status.REJECTED: "the user rejected it",
        }.get(message.status, "it was not applied")
        parts.append(f"(proposed {names}; {outcome})")
    return " ".join(parts)


def _last_attempt(user_message: Message) -> Message | None:
    return max(user_message.attempts.all(), key=lambda message: message.attempt, default=None)


def _history(conversation: Conversation, before: Message) -> tuple[list[Turn], list[str]]:
    """The last turns before `before` in full, and the user's requests before those."""
    users = list(
        conversation.messages.filter(role=Message.Role.USER, created_at__lt=before.created_at)
        .exclude(pk=before.pk)
        .prefetch_related("attempts")
    )
    recent = users[-settings.LLM_HISTORY_TURNS :] if settings.LLM_HISTORY_TURNS else []
    older = users[: len(users) - len(recent)]
    turns = [
        Turn(user=user.text, assistant=_assistant_summary(_last_attempt(user))) for user in recent
    ]
    return turns, [user.text for user in older]


def _attempt(client: LLMClient, user: object, input: AttemptInput) -> AttemptResult:
    """Runs one attempt and counts its tokens."""
    try:
        result = run_attempt(client, config.models(), input)
    except LLMUnavailable as error:
        raise AssistantUnavailable(str(error)) from error
    record_usage(user, result.usage)
    return result


def _save_attempt(
    conversation: Conversation, parent: Message, attempt: int, result: AttemptResult
) -> Message:
    return Message.objects.create(
        conversation=conversation,
        parent=parent,
        role=Message.Role.ASSISTANT,
        text=result.text,
        tool_calls=result.tool_calls,
        question=result.question,
        status=(
            Message.Status.INVALID
            if result.errors
            else Message.Status.PROPOSED
            if result.tool_calls
            else Message.Status.NONE
        ),
        errors=result.errors,
        model=result.model,
        input_tokens=result.usage.input_tokens,
        output_tokens=result.usage.output_tokens,
        cached_tokens=result.usage.cached_tokens,
        attempt=attempt,
    )


def _proposal(message: Message, result: AttemptResult) -> dict:
    return {
        "conversation_id": message.conversation_id,
        "message_id": message.id,
        "text": result.text,
        "tool_calls": result.tool_calls,
        "question": result.question,
        "errors": result.errors,
        "attempt": message.attempt,
        "retries_left": max(0, MAX_RETRIES - message.attempt),
    }


class DesignChatView(LLMThrottledMixin, OwnedQuerysetMixin, APIView):
    """The chat of a design: its latest conversation, and a new message to the assistant."""

    model = Design

    @extend_schema(responses={200: ConversationSerializer})
    def get(self, request: Request, pk: uuid.UUID) -> Response:
        design = get_object_or_404(self.owned(Design).only("id"), pk=pk)
        conversation = design.conversations.first()
        messages = conversation.messages.all() if conversation else Message.objects.none()
        return Response(
            {
                "conversation_id": conversation.id if conversation else None,
                "messages": MessageSerializer(messages, many=True).data,
            }
        )

    @extend_schema(request=ChatRequestSerializer, responses={200: ProposalSerializer})
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Asks the assistant. Its tool calls are a proposal: nothing changes until accepted."""
        design = get_object_or_404(self.owned(Design).only("id"), pk=pk)
        serializer = ChatRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        check_quota(request.user)
        client = config.get_client()

        if data.get("conversation_id"):
            conversation = get_object_or_404(
                Conversation.objects.filter(design=design), pk=data["conversation_id"]
            )
        else:
            conversation = Conversation.objects.create(design=design)
        user_message = Message.objects.create(
            conversation=conversation, role=Message.Role.USER, text=data["message"]
        )
        history, earlier = _history(conversation, user_message)
        try:
            result = _attempt(
                client,
                request.user,
                AttemptInput(
                    message=data["message"],
                    summary=data["summary"],
                    history=history,
                    earlier=earlier,
                    catalog=catalogs.published_catalog(),
                ),
            )
        except AssistantUnavailable:
            # Nothing was answered, so the message is not kept: the user sends it again.
            user_message.delete()
            raise
        message = _save_attempt(conversation, user_message, 0, result)
        return Response(_proposal(message, result))


class MessageRetryView(LLMThrottledMixin, OwnedQuerysetMixin, APIView):
    model = Message

    @extend_schema(request=RetryRequestSerializer, responses={200: ProposalSerializer})
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Asks again after a failed attempt, with the reasons it failed. Twice at most."""
        # Another account's message is a 404 before its body is looked at.
        get_object_or_404(self.get_queryset().only("id"), pk=pk)
        serializer = RetryRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            previous = get_object_or_404(
                self.get_queryset().select_for_update().filter(role=Message.Role.ASSISTANT), pk=pk
            )
            if previous.attempt >= MAX_RETRIES:
                raise NoRetriesLeft()
            if previous.status not in (Message.Status.PROPOSED, Message.Status.INVALID):
                raise NotPending()
            if previous.parent.attempts.filter(attempt__gt=previous.attempt).exists():
                raise NotPending("This attempt was already retried.")
            previous.status = Message.Status.INVALID
            previous.errors = [*previous.errors, *data["errors"]]
            previous.save(update_fields=["status", "errors"])
        check_quota(request.user)
        client = config.get_client()

        parent = previous.parent
        history, earlier = _history(previous.conversation, parent)
        result = _attempt(
            client,
            request.user,
            AttemptInput(
                message=parent.text,
                summary=data["summary"],
                history=history,
                earlier=earlier,
                attempt=previous.attempt + 1,
                previous_tool_calls=previous.tool_calls,
                errors=previous.errors,
                catalog=catalogs.published_catalog(),
                # A retry is an edit that went wrong: it never goes back to the router model.
                category="complex_edit",
            ),
        )
        message = _save_attempt(previous.conversation, parent, previous.attempt + 1, result)
        return Response(_proposal(message, result))


class MessageResolveView(OwnedQuerysetMixin, APIView):
    model = Message

    @extend_schema(request=ResolveRequestSerializer, responses={200: MessageSerializer})
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Records what the user did with a proposal, or that it could not be used."""
        get_object_or_404(self.get_queryset().only("id"), pk=pk)
        serializer = ResolveRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]
        with transaction.atomic():
            message = get_object_or_404(
                self.get_queryset().select_for_update().filter(role=Message.Role.ASSISTANT), pk=pk
            )
            pending = message.status == Message.Status.PROPOSED or (
                message.status == Message.Status.INVALID and new_status == Message.Status.INVALID
            )
            if not pending:
                raise NotPending()
            message.status = new_status
            message.save(update_fields=["status"])
        return Response(MessageSerializer(message).data)


class UsageView(APIView):
    @extend_schema(responses={200: UsageSerializer})
    def get(self, request: Request) -> Response:
        """This month's assistant usage of the signed-in user, and the monthly allowance."""
        usage = usage_for(request.user)
        quota = settings.LLM_MONTHLY_TOKEN_QUOTA
        return Response(
            {
                "month": usage.month,
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "requests": usage.requests,
                "quota_tokens": quota,
                "remaining_tokens": max(0, quota - usage.tokens),
            }
        )

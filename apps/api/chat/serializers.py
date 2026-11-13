from django.conf import settings
from rest_framework import serializers

from .models import Message

MAX_ERRORS = 20
MAX_ERROR_LENGTH = 500


class ToolCallSerializer(serializers.Serializer):
    name = serializers.CharField()
    arguments = serializers.DictField()


def _limited(value: str, limit: int, what: str) -> str:
    # The limits are read on each request, not when the module loads, so settings apply.
    if len(value) > limit:
        raise serializers.ValidationError(f"The {what} is longer than {limit:,} characters.")
    return value


class ChatRequestSerializer(serializers.Serializer):
    message = serializers.CharField()
    # The document as core's `summarizeForLLM` wrote it in the browser.
    summary = serializers.CharField()
    conversation_id = serializers.UUIDField(required=False, allow_null=True)

    def validate_message(self, value: str) -> str:
        return _limited(value, settings.LLM_MAX_MESSAGE_CHARS, "message")

    def validate_summary(self, value: str) -> str:
        return _limited(value, settings.LLM_MAX_SUMMARY_CHARS, "design summary")


class RetryRequestSerializer(serializers.Serializer):
    # Why the browser could not use the proposal, as core worded it for the model.
    errors = serializers.ListField(
        child=serializers.CharField(max_length=MAX_ERROR_LENGTH),
        max_length=MAX_ERRORS,
        allow_empty=False,
    )
    summary = serializers.CharField()

    def validate_summary(self, value: str) -> str:
        return _limited(value, settings.LLM_MAX_SUMMARY_CHARS, "design summary")


class ResolveRequestSerializer(serializers.Serializer):
    """`invalid` reports a proposal the browser could not use after the last retry."""

    status = serializers.ChoiceField(
        choices=[Message.Status.ACCEPTED, Message.Status.REJECTED, Message.Status.INVALID]
    )


class ProposalSerializer(serializers.Serializer):
    """One assistant attempt."""

    conversation_id = serializers.UUIDField()
    message_id = serializers.UUIDField()
    text = serializers.CharField(allow_blank=True)
    tool_calls = ToolCallSerializer(many=True)
    # A clarifying question; then there are no tool calls.
    question = serializers.CharField(allow_blank=True)
    # Set when the server dropped the proposal as malformed. Send them back with a retry.
    errors = serializers.ListField(child=serializers.CharField())
    attempt = serializers.IntegerField()
    retries_left = serializers.IntegerField()


class MessageSerializer(serializers.ModelSerializer):
    tool_calls = ToolCallSerializer(many=True)

    class Meta:
        model = Message
        fields = (
            "id",
            "role",
            "text",
            "tool_calls",
            "question",
            "status",
            "attempt",
            "parent",
            "created_at",
        )
        read_only_fields = fields


class ConversationSerializer(serializers.Serializer):
    conversation_id = serializers.UUIDField(allow_null=True)
    messages = MessageSerializer(many=True)


class UsageSerializer(serializers.Serializer):
    month = serializers.DateField()
    input_tokens = serializers.IntegerField()
    output_tokens = serializers.IntegerField()
    requests = serializers.IntegerField()
    quota_tokens = serializers.IntegerField()
    remaining_tokens = serializers.IntegerField()

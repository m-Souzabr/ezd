import uuid
from typing import TYPE_CHECKING

from django.conf import settings as django_settings
from django.db import models

from projects.models import Design

if TYPE_CHECKING:
    from accounts.models import User


class ConversationQuerySet(models.QuerySet["Conversation"]):
    def for_user(self, user: "User") -> "ConversationQuerySet":
        return self.filter(design__project__owner=user, design__project__archived_at__isnull=True)


class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    design = models.ForeignKey(Design, on_delete=models.CASCADE, related_name="conversations")
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ConversationQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"Conversation {self.id}"


class MessageQuerySet(models.QuerySet["Message"]):
    def for_user(self, user: "User") -> "MessageQuerySet":
        return self.filter(
            conversation__design__project__owner=user,
            conversation__design__project__archived_at__isnull=True,
        )


class Message(models.Model):
    """One user message, or one attempt of the assistant at answering it.

    An assistant message with tool calls is a proposal. The browser dry-runs it; if it
    fails, a retry adds another assistant message for the same user message, one attempt
    later.
    """

    class Role(models.TextChoices):
        USER = "user"
        ASSISTANT = "assistant"

    class Status(models.TextChoices):
        NONE = "none"
        PROPOSED = "proposed"
        ACCEPTED = "accepted"
        REJECTED = "rejected"
        INVALID = "invalid"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    # For an assistant message, the user message it answers.
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="attempts"
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    text = models.TextField(blank=True)
    # `[{name, arguments}]`, each checked against its tool's schema.
    tool_calls = models.JSONField(default=list)
    # A clarifying question from `ask_user`.
    question = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NONE)
    # Why the attempt failed: a malformed call found by the server, or the dry run's errors.
    errors = models.JSONField(default=list)
    model = models.CharField(max_length=100, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cached_tokens = models.PositiveIntegerField(default=0)
    attempt = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = MessageQuerySet.as_manager()

    class Meta:
        ordering = ("created_at",)

    def __str__(self) -> str:
        return f"{self.role} message {self.id}"


class Usage(models.Model):
    """What one user spent on the assistant in one calendar month (UTC)."""

    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="llm_usage"
    )
    # The first day of the month.
    month = models.DateField()
    input_tokens = models.PositiveBigIntegerField(default=0)
    output_tokens = models.PositiveBigIntegerField(default=0)
    requests = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = (models.UniqueConstraint(fields=["user", "month"], name="unique_user_month"),)

    def __str__(self) -> str:
        return f"Usage {self.user_id} {self.month:%Y-%m}"

    @property
    def tokens(self) -> int:
        return self.input_tokens + self.output_tokens

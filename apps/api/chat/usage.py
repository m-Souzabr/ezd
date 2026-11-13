"""The monthly allowance of model tokens, shared by the chat and photo analysis."""

from datetime import date

from django.conf import settings
from django.db.models import F
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException

from llm.client import Usage as TokenUsage

from .models import Usage


class QuotaExceeded(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_code = "quota_exceeded"


def current_month() -> date:
    return timezone.now().date().replace(day=1)


def usage_for(user: object) -> Usage:
    usage, _ = Usage.objects.get_or_create(user=user, month=current_month())
    return usage


def check_quota(user: object) -> None:
    """Raises `QuotaExceeded` once the user has spent this month's allowance."""
    usage = usage_for(user)
    quota = settings.LLM_MONTHLY_TOKEN_QUOTA
    if usage.tokens >= quota:
        raise QuotaExceeded(
            f"You have used this month's assistant allowance of {quota:,} tokens. "
            "It renews on the first of next month."
        )


def record_usage(user: object, tokens: TokenUsage) -> None:
    """Adds one model call and its tokens to the user's month."""
    Usage.objects.filter(pk=usage_for(user).pk).update(
        input_tokens=F("input_tokens") + tokens.input_tokens,
        output_tokens=F("output_tokens") + tokens.output_tokens,
        requests=F("requests") + 1,
    )

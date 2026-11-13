from typing import Any

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode


def reset_link(user: Any) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"


def send_reset_email(user: Any) -> None:
    send_mail(
        subject="Reset your EZDesign password",
        message=(
            "Someone asked to reset the password of your EZDesign account.\n\n"
            f"Choose a new password here:\n{reset_link(user)}\n\n"
            "If it was not you, ignore this email and nothing changes.\n"
        ),
        from_email=None,
        recipient_list=[user.email],
    )


def send_invite_email(user: Any, invited_by: Any) -> None:
    """Asks a new account's owner to choose a password. The link is the reset link."""
    who = invited_by.name or invited_by.email
    send_mail(
        subject="You have been invited to EZDesign",
        message=(
            f"{who} created an EZDesign account for you.\n\n"
            f"Set your password here to sign in:\n{reset_link(user)}\n\n"
            "The link works once and expires after a few days.\n"
        ),
        from_email=None,
        recipient_list=[user.email],
    )

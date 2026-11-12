import pytest
from django.conf import settings
from django.contrib.auth import get_user_model

from accounts.models import User


def test_auth_user_model_is_the_custom_user() -> None:
    assert settings.AUTH_USER_MODEL == "accounts.User"
    assert get_user_model() is User
    assert User.USERNAME_FIELD == "email"


@pytest.mark.django_db
def test_create_user_logs_in_with_email() -> None:
    user = User.objects.create_user(email="Ada@Example.com", password="s3cret-pass")

    assert user.email == "Ada@example.com"
    assert user.check_password("s3cret-pass")
    assert not user.is_staff
    assert not hasattr(user, "username") or user.username is None


@pytest.mark.django_db
def test_create_superuser() -> None:
    admin = User.objects.create_superuser(email="root@example.com", password="s3cret-pass")

    assert admin.is_staff
    assert admin.is_superuser


@pytest.mark.django_db
def test_email_is_required() -> None:
    with pytest.raises(ValueError, match="email"):
        User.objects.create_user(email="", password="s3cret-pass")

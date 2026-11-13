from typing import Any

from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from controlpanel.permissions import permissions_of

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "name", "is_staff", "is_superuser", "permissions")
        read_only_fields = fields

    def get_permissions(self, user: Any) -> list[str]:
        """The Control Panel codes the user holds; the web app only uses them to hide things."""
        return permissions_of(user)


def check_password(password: str, user: Any) -> None:
    try:
        password_validation.validate_password(password, user)
    except DjangoValidationError as error:
        raise serializers.ValidationError({"password": list(error.messages)}) from error


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)
    name = serializers.CharField(max_length=150, allow_blank=True, default="")

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        # The validators compare the password with the email and name, so they need a user.
        check_password(attrs["password"], User(email=attrs["email"], name=attrs["name"]))
        return attrs

    def create(self, validated_data: dict[str, Any]) -> Any:
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)


class PasswordResetSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)

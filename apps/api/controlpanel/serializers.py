from typing import Any

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import serializers

from .models import AuditEntry

User = get_user_model()


class AdminUserSerializer(serializers.ModelSerializer):
    roles = serializers.SerializerMethodField()
    active_projects = serializers.IntegerField(read_only=True)
    chat_tokens_this_month = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "name",
            "is_active",
            "is_staff",
            "is_superuser",
            "roles",
            "last_login",
            "date_joined",
            "active_projects",
            "chat_tokens_this_month",
        )
        read_only_fields = fields

    def get_roles(self, user: Any) -> list[str]:
        # Reads the prefetched groups, so a list of users costs one query for all of them.
        return sorted(group.name for group in user.groups.all())


def unique_email(value: str, exclude_pk: Any = None) -> str:
    taken = User.objects.filter(email__iexact=value)
    if exclude_pk is not None:
        taken = taken.exclude(pk=exclude_pk)
    if taken.exists():
        raise serializers.ValidationError("An account with this email already exists.")
    return value


class RoleNamesField(serializers.ListField):
    child = serializers.CharField(max_length=150)

    def to_internal_value(self, data: Any) -> list[str]:
        names = super().to_internal_value(data)
        known = set(Group.objects.filter(name__in=names).values_list("name", flat=True))
        unknown = sorted(set(names) - known)
        if unknown:
            raise serializers.ValidationError(f"Unknown role: {', '.join(unknown)}.")
        return sorted(set(names))


class AdminUserCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    name = serializers.CharField(max_length=150, allow_blank=True, default="")
    is_staff = serializers.BooleanField(default=False)
    roles = RoleNamesField(required=False)

    def validate_email(self, value: str) -> str:
        return unique_email(value)


class AdminUserUpdateSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254, required=False)
    name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    is_active = serializers.BooleanField(required=False)
    is_staff = serializers.BooleanField(required=False)
    is_superuser = serializers.BooleanField(required=False)
    roles = RoleNamesField(required=False)

    def validate_email(self, value: str) -> str:
        return unique_email(value, self.context["target"].pk)


class RoleSerializer(serializers.Serializer):
    name = serializers.CharField()
    permissions = serializers.ListField(child=serializers.CharField())

    @classmethod
    def of(cls, group: Group) -> dict[str, Any]:
        held = {permission.codename for permission in group.permissions.all()}
        return {"name": group.name, "permissions": sorted(held)}


class AuditEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEntry
        fields = (
            "id",
            "actor",
            "actor_email",
            "action",
            "object_type",
            "object_id",
            "before",
            "after",
            "created_at",
        )
        read_only_fields = fields

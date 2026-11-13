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


class AppConfigSerializer(serializers.Serializer):
    """The published configuration, as the web app reads it."""

    version = serializers.IntegerField(allow_null=True)
    config = serializers.JSONField()
    # The rules' switches, severities, thresholds and snap options. `{}` means the defaults.
    rules_config = serializers.JSONField()
    # The rates a new quote starts from, and the branding without its logo.
    quote_defaults = serializers.JSONField()


class ConfigDraftSerializer(serializers.Serializer):
    # 0 while no draft has been saved: the config is then the published one.
    revision = serializers.IntegerField()
    app_config = serializers.JSONField()
    rules_config = serializers.JSONField()
    quote_defaults = serializers.JSONField()
    based_on = serializers.IntegerField(allow_null=True)
    updated_at = serializers.DateTimeField(allow_null=True)


class ConfigDraftUpdateSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    # Each is saved only when given, and needs its own permission.
    app_config = serializers.JSONField(required=False)
    rules_config = serializers.JSONField(required=False)
    quote_defaults = serializers.JSONField(required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not any(name in attrs for name in ("app_config", "rules_config", "quote_defaults")):
            raise serializers.ValidationError("Give at least one section to save.")
        return attrs


class ConfigPublishSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)
    note = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")


class ConfigRollbackSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")


class ConfigVersionSerializer(serializers.Serializer):
    number = serializers.IntegerField()
    status = serializers.ChoiceField(choices=("published", "superseded"))
    note = serializers.CharField()
    created_by = serializers.CharField()
    created_at = serializers.DateTimeField()


class CatalogSerializer(serializers.Serializer):
    """A published catalog, as the web app and the server read it."""

    version = serializers.CharField()
    catalog = serializers.JSONField()


class CatalogDraftSerializer(serializers.Serializer):
    # 0 while no draft has been saved: the catalog is then the published one.
    revision = serializers.IntegerField()
    catalog = serializers.JSONField()
    based_on = serializers.CharField(allow_null=True)
    updated_at = serializers.DateTimeField(allow_null=True)


class CatalogDraftUpdateSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    catalog = serializers.JSONField()


class CatalogValidateSerializer(serializers.Serializer):
    # Leave it out to check the draft (or the published catalog if there is no draft).
    catalog = serializers.JSONField(required=False)


class CatalogProblemSerializer(serializers.Serializer):
    path = serializers.CharField()
    message = serializers.CharField()


class CatalogValidationSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    problems = CatalogProblemSerializer(many=True)


class CatalogPublishSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)
    note = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")


class CatalogRollbackSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")


class CatalogVersionSerializer(serializers.Serializer):
    number = serializers.IntegerField()
    version = serializers.CharField()
    # Whether it is the catalog the app uses now.
    current = serializers.BooleanField()
    note = serializers.CharField()
    created_by = serializers.CharField()
    created_at = serializers.DateTimeField()


class CatalogEntryCreateSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    entry = serializers.JSONField()


class CatalogEntryChangeSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    # The fields to replace, whole; a null removes an optional field. `id` cannot change.
    changes = serializers.JSONField()


class CatalogRevisionSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)


class CatalogFinishCreateSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    finish = serializers.JSONField()

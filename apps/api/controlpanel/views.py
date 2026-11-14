import csv
import datetime
import json
from typing import Any

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.sessions.models import Session
from django.db import transaction
from django.db.models import Count, IntegerField, OuterRef, Q, QuerySet, Subquery, Sum
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.emails import send_invite_email, send_reset_email
from chat.models import Usage
from chat.usage import current_month

from . import audit
from .audit import scrub
from .codes import (
    AUDIT_VIEW,
    PROTECTED_ROLES,
    ROLES_MANAGE,
    USERS_MANAGE,
    USERS_ROLES_ASSIGN,
    USERS_VIEW,
)
from .guards import GuardError, check_change
from .models import AuditEntry
from .permissions import HasControlPanelPerm, can, permission_rows
from .serializers import (
    AdminUserCreateSerializer,
    AdminUserSerializer,
    AdminUserUpdateSerializer,
    AuditEntrySerializer,
    RoleSerializer,
    RoleWriteSerializer,
)

User = get_user_model()

USER_SORTS = {"email", "name", "last_login", "date_joined", "active_projects", "chat_tokens"}


# Marks a view of the Control Panel: staff only, with the permission it declares. (A comment,
# not a docstring: drf-spectacular would copy a docstring into every endpoint.)
class ControlPanelView:
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm: Any = None


def users_queryset() -> QuerySet[Any]:
    month_tokens = (
        Usage.objects.filter(user=OuterRef("pk"), month=current_month())
        .values("user")
        .annotate(total=Sum("input_tokens") + Sum("output_tokens"))
        .values("total")
    )
    return (
        User.objects.annotate(
            # Both are subqueries or counted on one join, so the numbers do not multiply.
            active_projects=Count("projects", filter=Q(projects__archived_at__isnull=True)),
            chat_tokens_this_month=Coalesce(Subquery(month_tokens, output_field=IntegerField()), 0),
        )
        .prefetch_related("groups")
        .order_by("email")
    )


def user_snapshot(user: Any) -> dict[str, Any]:
    return {
        "email": user.email,
        "name": user.name,
        "is_active": user.is_active,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "roles": sorted(group.name for group in user.groups.all()),
    }


def end_sessions(user: Any) -> None:
    """Signs the user out everywhere."""
    for session in Session.objects.filter(expire_date__gte=timezone.now()):
        if session.get_decoded().get("_auth_user_id") == str(user.pk):
            session.delete()


class GuardRefused(serializers.ValidationError):
    pass


def refuse(error: GuardError) -> GuardRefused:
    return GuardRefused({"detail": str(error)})


class UserListView(ControlPanelView, generics.ListCreateAPIView):
    """Every account, for staff. Searchable, filterable and sortable."""

    control_panel_perm = {"GET": USERS_VIEW, "POST": USERS_MANAGE}

    def get_serializer_class(self) -> Any:
        return AdminUserCreateSerializer if self.request.method == "POST" else AdminUserSerializer

    def get_queryset(self) -> QuerySet[Any]:
        params = self.request.query_params
        users = users_queryset()
        if search := params.get("search", "").strip():
            users = users.filter(Q(email__icontains=search) | Q(name__icontains=search))
        for field in ("is_active", "is_staff"):
            if params.get(field) in ("true", "false"):
                users = users.filter(**{field: params[field] == "true"})
        if role := params.get("role"):
            users = users.filter(groups__name=role)
        sort = params.get("sort", "email")
        name = sort.lstrip("-")
        if name == "chat_tokens":
            name = "chat_tokens_this_month"
        if sort.lstrip("-") in USER_SORTS:
            users = users.order_by(f"-{name}" if sort.startswith("-") else name, "email")
        return users

    @extend_schema(
        parameters=[
            OpenApiParameter("search", str, description="Part of the email or name."),
            OpenApiParameter("is_active", bool),
            OpenApiParameter("is_staff", bool),
            OpenApiParameter("role", str, description="The name of a role."),
            OpenApiParameter("sort", str, description="A column, with `-` for descending."),
        ],
        responses={200: AdminUserSerializer(many=True)},
    )
    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().get(request, *args, **kwargs)

    @extend_schema(request=AdminUserCreateSerializer, responses={201: AdminUserSerializer})
    def post(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        """Creates an account with no password and emails its owner a link to choose one."""
        serializer = AdminUserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        roles = data.get("roles", [])
        if roles and not can(request.user, USERS_ROLES_ASSIGN):
            self.permission_denied(request, message="You may not assign roles.")
        with transaction.atomic():
            user = User.objects.create_user(
                email=data["email"], password=None, name=data["name"], is_staff=data["is_staff"]
            )
            user.groups.set(Group.objects.filter(name__in=roles))
            audit.record(request.user, "user.invite", "user", user.pk, after=user_snapshot(user))
        send_invite_email(user, request.user)
        return Response(
            AdminUserSerializer(users_queryset().get(pk=user.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class UserDetailView(ControlPanelView, generics.RetrieveUpdateAPIView):
    control_panel_perm = {"GET": USERS_VIEW, "PATCH": USERS_MANAGE}
    http_method_names = ("get", "patch", "head", "options")
    queryset = users_queryset()
    serializer_class = AdminUserSerializer

    @extend_schema(request=AdminUserUpdateSerializer, responses={200: AdminUserSerializer})
    def patch(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        """Changes name, email, active, staff, superuser or roles."""
        target = self.get_object()
        serializer = AdminUserUpdateSerializer(
            data=request.data, partial=True, context={"target": target}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "roles" in data and not can(request.user, USERS_ROLES_ASSIGN):
            self.permission_denied(request, message="You may not assign roles.")
        before = user_snapshot(target)
        try:
            check_change(
                request.user,
                target,
                is_active=data.get("is_active", target.is_active),
                is_superuser=data.get("is_superuser", target.is_superuser),
                is_staff=data.get("is_staff", target.is_staff),
            )
        except GuardError as error:
            raise refuse(error) from error
        with transaction.atomic():
            for field in ("email", "name", "is_active", "is_staff", "is_superuser"):
                if field in data:
                    setattr(target, field, data[field])
            target.save()
            if "roles" in data:
                target.groups.set(Group.objects.filter(name__in=data["roles"]))
            target = users_queryset().get(pk=target.pk)
            audit.record(
                request.user,
                "user.update",
                "user",
                target.pk,
                before=before,
                after=user_snapshot(target),
            )
        if before["is_active"] and not target.is_active:
            end_sessions(target)
        return Response(AdminUserSerializer(target).data)


class UserResetPasswordView(ControlPanelView, APIView):
    control_panel_perm = USERS_MANAGE

    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request, pk: int) -> Response:
        """Emails the account's owner a link to choose a new password."""
        target = get_object_or_404(User, pk=pk)
        if not target.is_active:
            raise serializers.ValidationError({"detail": "The account is not active."})
        send_reset_email(target)
        audit.record(request.user, "user.reset_password", "user", target.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _holds_all(user: Any, codes: Any) -> bool:
    return all(can(user, code) for code in codes)


def _check_role_name(name: str, exclude_pk: int | None = None) -> str:
    name = name.strip()
    if not name:
        raise serializers.ValidationError({"name": "Give the role a name."})
    taken = Group.objects.filter(name__iexact=name)
    if exclude_pk is not None:
        taken = taken.exclude(pk=exclude_pk)
    if taken.exists():
        raise serializers.ValidationError({"name": "A role with this name already exists."})
    return name


def _role_snapshot(group: Group) -> dict[str, Any]:
    return {"name": group.name, "permissions": RoleSerializer.of(group)["permissions"]}


class RoleListView(ControlPanelView, APIView):
    control_panel_perm = {"GET": USERS_VIEW, "POST": ROLES_MANAGE}
    pagination_class = None

    @extend_schema(responses={200: RoleSerializer(many=True)})
    def get(self, request: Request) -> Response:
        """The roles and the permission codes each one holds."""
        groups = Group.objects.prefetch_related("permissions").order_by("name")
        return Response([RoleSerializer.of(group) for group in groups])

    @extend_schema(request=RoleWriteSerializer, responses={201: RoleSerializer})
    def post(self, request: Request) -> Response:
        """Creates a role. It cannot hold a permission its creator does not."""
        serializer = RoleWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "name" not in data:
            raise serializers.ValidationError({"name": "Give the role a name."})
        codes = sorted(set(data.get("permissions", [])))
        if not _holds_all(request.user, codes):
            raise PermissionDenied("A role cannot grant a permission you do not hold.")
        with transaction.atomic():
            group = Group.objects.create(name=_check_role_name(data["name"]))
            group.permissions.set(permission_rows(codes))
            audit.record(request.user, "role.create", "role", group.pk, after=_role_snapshot(group))
        return Response(RoleSerializer.of(group), status=status.HTTP_201_CREATED)


class RoleDetailView(ControlPanelView, APIView):
    control_panel_perm = {"PATCH": ROLES_MANAGE, "DELETE": ROLES_MANAGE}

    def _editable(self, request: Request, pk: int) -> Group:
        group = get_object_or_404(Group.objects.prefetch_related("permissions"), pk=pk)
        if group.name in PROTECTED_ROLES:
            raise PermissionDenied("The seeded roles cannot be changed.")
        held = RoleSerializer.of(group)["permissions"]
        if not _holds_all(request.user, held):
            raise PermissionDenied("You cannot change a role that holds permissions you do not.")
        return group

    @extend_schema(request=RoleWriteSerializer, responses={200: RoleSerializer})
    def patch(self, request: Request, pk: int) -> Response:
        """Renames a role or changes its permissions. Takes effect on its members' next request."""
        serializer = RoleWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        group = self._editable(request, pk)
        before = _role_snapshot(group)
        added = set(data.get("permissions", before["permissions"])) - set(before["permissions"])
        if not _holds_all(request.user, added):
            raise PermissionDenied("A role cannot grant a permission you do not hold.")
        with transaction.atomic():
            if "name" in data:
                group.name = _check_role_name(data["name"], group.pk)
                group.save()
            if "permissions" in data:
                group.permissions.set(permission_rows(sorted(set(data["permissions"]))))
            group = Group.objects.prefetch_related("permissions").get(pk=group.pk)
            audit.record(
                request.user,
                "role.update",
                "role",
                group.pk,
                before=before,
                after=_role_snapshot(group),
            )
        return Response(RoleSerializer.of(group))

    @extend_schema(request=None, responses={204: None})
    def delete(self, request: Request, pk: int) -> Response:
        """Deletes a role. Whoever held it loses what it gave, on their next request."""
        group = self._editable(request, pk)
        before = {**_role_snapshot(group), "members": group.user_set.count()}
        with transaction.atomic():
            group.delete()
            audit.record(request.user, "role.delete", "role", pk, before=before)
        return Response(status=status.HTTP_204_NO_CONTENT)


def filtered_audit(params: Any) -> QuerySet[Any]:
    """The audit entries matching the query string, newest first."""
    entries = AuditEntry.objects.all()
    if actor := params.get("actor"):
        entries = entries.filter(
            Q(actor_email__icontains=actor) | Q(actor_id=int(actor) if actor.isdigit() else -1)
        )
    if action := params.get("action"):
        entries = entries.filter(action__startswith=action)
    if object_type := params.get("object_type"):
        entries = entries.filter(object_type=object_type)
    for name, lookup in (
        ("date_from", "created_at__date__gte"),
        ("date_to", "created_at__date__lte"),
    ):
        if value := params.get(name):
            try:
                day = datetime.date.fromisoformat(value)
            except ValueError as error:
                raise serializers.ValidationError({name: "Use a date like 2026-11-30."}) from error
            entries = entries.filter(**{lookup: day})
    return entries


AUDIT_PARAMETERS = [
    OpenApiParameter("actor", str, description="An actor's id or part of their email."),
    OpenApiParameter("action", str, description="An action, or the start of one."),
    OpenApiParameter("object_type", str, description="The kind of object changed."),
    OpenApiParameter("date_from", str, description="The first day, as YYYY-MM-DD."),
    OpenApiParameter("date_to", str, description="The last day, as YYYY-MM-DD."),
]


class AuditListView(ControlPanelView, generics.ListAPIView):
    control_panel_perm = AUDIT_VIEW
    serializer_class = AuditEntrySerializer

    def get_queryset(self) -> QuerySet[Any]:
        return filtered_audit(self.request.query_params)

    @extend_schema(parameters=AUDIT_PARAMETERS, responses={200: AuditEntrySerializer(many=True)})
    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().get(request, *args, **kwargs)


class AuditTypesView(ControlPanelView, APIView):
    control_panel_perm = AUDIT_VIEW
    pagination_class = None

    @extend_schema(responses={200: {"type": "array", "items": {"type": "string"}}})
    def get(self, request: Request) -> Response:
        """The kinds of object the log has entries for, for the filter."""
        kinds = AuditEntry.objects.order_by().values_list("object_type", flat=True).distinct()
        return Response(sorted(kinds))


# The most rows one export holds, so a download cannot exhaust the server.
MAX_EXPORT_ROWS = 20_000
CSV_COLUMNS = ("id", "time", "actor", "action", "object_type", "object_id", "before", "after")


def _csv_cell(value: Any) -> str:
    """A cell a spreadsheet will not run as a formula."""
    text = "" if value is None else str(value)
    return f"'{text}" if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


class AuditExportView(ControlPanelView, APIView):
    control_panel_perm = AUDIT_VIEW

    @extend_schema(
        parameters=AUDIT_PARAMETERS,
        responses={(200, "text/csv"): OpenApiTypes.STR},
    )
    def get(self, request: Request) -> HttpResponse:
        """The entries matching the filters as CSV, with the secrets masked."""
        entries = filtered_audit(request.query_params)[:MAX_EXPORT_ROWS]
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="audit.csv"'
        writer = csv.writer(response)
        writer.writerow(CSV_COLUMNS)
        for entry in entries:
            writer.writerow(
                [
                    _csv_cell(value)
                    for value in (
                        entry.pk,
                        entry.created_at.isoformat(),
                        entry.actor_email,
                        entry.action,
                        entry.object_type,
                        entry.object_id,
                        json.dumps(scrub(entry.before), sort_keys=True),
                        json.dumps(scrub(entry.after), sort_keys=True),
                    )
                ]
            )
        audit.record(request.user, "audit.export", "audit", "", after=dict(request.query_params))
        return response

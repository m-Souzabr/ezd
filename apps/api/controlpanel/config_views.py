from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F, Max
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import appconfig, audit
from .codes import APP_EDIT
from .models import ConfigVersion
from .permissions import HasControlPanelPerm
from .serializers import (
    AppConfigSerializer,
    ConfigDraftSerializer,
    ConfigDraftUpdateSerializer,
    ConfigPublishSerializer,
    ConfigRollbackSerializer,
    ConfigVersionSerializer,
)

Status = ConfigVersion.Status
OBJECT_TYPE = "config_version"
PUBLIC_MAX_AGE_SECONDS = 30


class PublicConfigView(APIView):
    """The published configuration. Anyone may read it: the editor at `/` needs no session."""

    permission_classes = (AllowAny,)
    # No session is read, so the answer does not vary by cookie and may be cached.
    authentication_classes = ()

    @extend_schema(responses={200: AppConfigSerializer})
    def get(self, request: Request) -> Response:
        row = appconfig.published()
        response = Response(
            {
                "version": row.number if row else None,
                "config": appconfig.effective(row.app_config if row else {}),
            }
        )
        response["Cache-Control"] = f"public, max-age={PUBLIC_MAX_AGE_SECONDS}"
        return response


def _draft_payload(row: ConfigVersion | None) -> dict[str, Any]:
    base = appconfig.published()
    if row is None:
        return {
            "revision": 0,
            "app_config": base.app_config if base else {},
            "based_on": base.number if base else None,
            "updated_at": None,
        }
    return {
        "revision": row.revision,
        "app_config": row.app_config,
        "based_on": base.number if base else None,
        "updated_at": row.updated_at,
    }


def _snapshot(row: ConfigVersion | None) -> dict[str, Any] | None:
    return {"number": row.number, "app_config": row.app_config} if row else None


class ConfigDraftView(APIView):
    """The configuration being edited. Without a saved draft it is the published one."""

    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = APP_EDIT

    @extend_schema(responses={200: ConfigDraftSerializer})
    def get(self, request: Request) -> Response:
        return Response(_draft_payload(appconfig.draft()))

    @extend_schema(request=ConfigDraftUpdateSerializer, responses={200: ConfigDraftSerializer})
    def put(self, request: Request) -> Response:
        """Saves the draft if `revision` is the one the editor loaded, else 409."""
        serializer = ConfigDraftUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        revision = serializer.validated_data["revision"]
        config = appconfig.validate_config(serializer.validated_data["app_config"])
        before = appconfig.draft()
        # One UPDATE on the row's own columns, so two saves cannot both succeed.
        if revision == 0:
            try:
                with transaction.atomic():
                    row = ConfigVersion.objects.create(
                        status=Status.DRAFT, app_config=config, created_by=request.user
                    )
            except IntegrityError as error:
                raise appconfig.StaleDraft() from error
        else:
            changed = ConfigVersion.objects.filter(status=Status.DRAFT, revision=revision).update(
                app_config=config, revision=F("revision") + 1
            )
            if not changed:
                raise appconfig.StaleDraft()
            row = appconfig.draft()
            assert row is not None
        audit.record(
            request.user,
            "config.draft.save",
            OBJECT_TYPE,
            row.pk,
            before=_snapshot(before),
            after=_snapshot(row),
        )
        return Response(_draft_payload(row))


class ConfigPublishView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = APP_EDIT

    @extend_schema(request=ConfigPublishSerializer, responses={200: ConfigVersionSerializer})
    def post(self, request: Request) -> Response:
        """Makes the draft the new published version, which is never changed again."""
        serializer = ConfigPublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            draft = ConfigVersion.objects.select_for_update().filter(status=Status.DRAFT).first()
            if draft is None or draft.revision != serializer.validated_data["revision"]:
                raise appconfig.StaleDraft()
            config = appconfig.validate_config(draft.app_config)
            previous = appconfig.published()
            if previous:
                ConfigVersion.objects.filter(pk=previous.pk).update(status=Status.SUPERSEDED)
            draft.number = (ConfigVersion.objects.aggregate(m=Max("number"))["m"] or 0) + 1
            draft.status = Status.PUBLISHED
            draft.app_config = config
            draft.note = serializer.validated_data["note"].strip()
            draft.created_by = request.user
            draft.save()
        audit.record(
            request.user,
            "config.publish",
            OBJECT_TYPE,
            draft.pk,
            before=_snapshot(previous),
            after={**_snapshot(draft), "note": draft.note},  # type: ignore[dict-item]
        )
        return Response(_version_row(draft))


def _version_row(row: ConfigVersion) -> dict[str, Any]:
    return {
        "number": row.number,
        "status": row.status,
        "note": row.note,
        "created_by": row.created_by.email if row.created_by else "",
        "created_at": row.created_at,
    }


class ConfigVersionListView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = APP_EDIT
    pagination_class = None

    @extend_schema(responses={200: ConfigVersionSerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = (
            ConfigVersion.objects.exclude(status=Status.DRAFT)
            .select_related("created_by")
            .order_by("-number")
        )
        return Response([_version_row(row) for row in rows])


class ConfigRollbackView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = APP_EDIT

    @extend_schema(request=ConfigRollbackSerializer, responses={200: ConfigVersionSerializer})
    def post(self, request: Request, number: int) -> Response:
        """Publishes a copy of an old version as a new one. The old rows stay as they were."""
        serializer = ConfigRollbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            target = get_object_or_404(
                ConfigVersion.objects.exclude(status=Status.DRAFT), number=number
            )
            previous = appconfig.published()
            if previous and previous.pk == target.pk:
                raise appconfig.StaleDraft(f"Version {number} is already the published one.")
            if previous:
                ConfigVersion.objects.filter(pk=previous.pk).update(status=Status.SUPERSEDED)
            row = ConfigVersion.objects.create(
                number=(ConfigVersion.objects.aggregate(m=Max("number"))["m"] or 0) + 1,
                status=Status.PUBLISHED,
                app_config=target.app_config,
                note=serializer.validated_data["note"].strip()
                or f"Rolled back to version {number}",
                created_by=request.user,
            )
        audit.record(
            request.user,
            "config.rollback",
            OBJECT_TYPE,
            row.pk,
            before=_snapshot(previous),
            after={**_snapshot(row), "restored_from": number},  # type: ignore[dict-item]
        )
        return Response(_version_row(row))

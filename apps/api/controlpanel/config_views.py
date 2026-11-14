from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F, Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import appconfig, audit
from .codes import APP_EDIT, QUOTE_EDIT, RULES_EDIT
from .models import ConfigVersion
from .permissions import HasControlPanelPerm, can
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

# The three sections of a configuration version, each with the permission to edit it. The
# page for a section is for whoever holds its code; the draft and the versions are shared.
SECTIONS = {
    "app_config": APP_EDIT,
    "rules_config": RULES_EDIT,
    "quote_defaults": QUOTE_EDIT,
}
ANY_SECTION = tuple(SECTIONS.values())
SECTION_NAMES = {
    "app_config": "the app settings",
    "rules_config": "the rules",
    "quote_defaults": "the quote defaults",
}


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
                "rules_config": row.rules_config if row else {},
                "quote_defaults": appconfig.public_quote_defaults(
                    row.quote_defaults if row else {}
                ),
            }
        )
        response["Cache-Control"] = f"public, max-age={PUBLIC_MAX_AGE_SECONDS}"
        return response


def _sections(row: ConfigVersion | None) -> dict[str, Any]:
    return {name: getattr(row, name) if row else {} for name in SECTIONS}


def _editor(row: ConfigVersion | None) -> str:
    editor = (row.updated_by or row.created_by) if row else None
    return editor.email if editor else ""


def _draft_payload(row: ConfigVersion | None) -> dict[str, Any]:
    base = appconfig.published()
    return {
        "revision": row.revision if row else 0,
        **_sections(row or base),
        "based_on": base.number if base else None,
        "updated_at": row.updated_at if row else None,
        "updated_by": _editor(row),
    }


def _redact(sections: dict[str, Any]) -> dict[str, Any]:
    """The sections as the audit log keeps them: a logo is a size, not a megabyte of text."""
    defaults = sections.get("quote_defaults") or {}
    logo = (defaults.get("branding") or {}).get("logo")
    if not logo:
        return sections
    branding = {**defaults["branding"], "logo": f"<logo of {len(logo)} characters>"}
    return {**sections, "quote_defaults": {**defaults, "branding": branding}}


def _snapshot(row: ConfigVersion | None) -> dict[str, Any] | None:
    return {"number": row.number, **_redact(_sections(row))} if row else None


CHECKS = {
    "app_config": appconfig.validate_config,
    "rules_config": appconfig.validate_rules_config,
    "quote_defaults": appconfig.validate_quote_defaults,
}


def _require_for_changes(user: Any, before: ConfigVersion | None, after: dict[str, Any]) -> None:
    """Refuses a publish that changes a section the user may not edit.

    A section counts as changed only if its meaning is, so `{}` and the same section with
    every default filled in are the same: the first publish does not change what was not edited.
    """
    for name, code in SECTIONS.items():
        previous = getattr(before, name) if before else {}
        if previous == after[name] or can(user, code):
            continue
        if CHECKS[name](previous) != after[name]:
            raise PermissionDenied(
                f"This changes {SECTION_NAMES[name]}, which you do not have permission to publish."
            )


def save_sections(user: Any, revision: int, values: dict[str, Any]) -> ConfigVersion:
    """Saves sections to the draft if `revision` is the saved one, else 409.

    One UPDATE on the row's own columns, so two saves cannot both succeed.
    """
    if revision == 0:
        # A section that is not given starts from what is published, not from nothing.
        start = {**_sections(appconfig.published()), **values}
        try:
            with transaction.atomic():
                return ConfigVersion.objects.create(
                    status=Status.DRAFT, created_by=user, updated_by=user, **start
                )
        except IntegrityError as error:
            raise appconfig.StaleDraft(draft=appconfig.draft()) from error
    changed = ConfigVersion.objects.filter(status=Status.DRAFT, revision=revision).update(
        **values, revision=F("revision") + 1, updated_by=user, updated_at=timezone.now()
    )
    if not changed:
        raise appconfig.StaleDraft(draft=appconfig.draft())
    row = appconfig.draft()
    assert row is not None
    return row


class ConfigDraftView(APIView):
    """The configuration being edited. Without a saved draft it is the published one.

    Reading it needs any of the three edit permissions. Saving a section needs the
    permission for that section.
    """

    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = {"GET": ANY_SECTION, "PUT": ANY_SECTION}
    # Three sections and a logo of at most 150 KB.
    max_body_bytes = 512 * 1024

    @extend_schema(responses={200: ConfigDraftSerializer})
    def get(self, request: Request) -> Response:
        return Response(_draft_payload(appconfig.draft()))

    @extend_schema(request=ConfigDraftUpdateSerializer, responses={200: ConfigDraftSerializer})
    def put(self, request: Request) -> Response:
        """Saves the sections given, if `revision` is the one the editor loaded, else 409."""
        serializer = ConfigDraftUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        given = [name for name in SECTIONS if name in data]
        for name in given:
            if not can(request.user, SECTIONS[name]):
                raise PermissionDenied(f"You do not have permission to edit {SECTION_NAMES[name]}.")
        values = {name: CHECKS[name](data[name]) for name in given}
        before = appconfig.draft()
        row = save_sections(request.user, data["revision"], values)
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
    control_panel_perm = ANY_SECTION

    @extend_schema(request=ConfigPublishSerializer, responses={200: ConfigVersionSerializer})
    def post(self, request: Request) -> Response:
        """Makes the draft the new published version, which is never changed again.

        It publishes every section of the draft, so it is refused if the draft has changed
        one the user may not edit.
        """
        serializer = ConfigPublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            draft = ConfigVersion.objects.select_for_update().filter(status=Status.DRAFT).first()
            if draft is None or draft.revision != serializer.validated_data["revision"]:
                raise appconfig.StaleDraft(draft=draft)
            filled = {name: CHECKS[name](getattr(draft, name)) for name in SECTIONS}
            previous = appconfig.published()
            _require_for_changes(request.user, previous, filled)
            if previous:
                ConfigVersion.objects.filter(pk=previous.pk).update(status=Status.SUPERSEDED)
            draft.number = (ConfigVersion.objects.aggregate(m=Max("number"))["m"] or 0) + 1
            draft.status = Status.PUBLISHED
            for name, value in filled.items():
                setattr(draft, name, value)
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
    control_panel_perm = ANY_SECTION
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
    control_panel_perm = ANY_SECTION

    @extend_schema(request=ConfigRollbackSerializer, responses={200: ConfigVersionSerializer})
    def post(self, request: Request, number: int) -> Response:
        """Publishes a copy of an old version as a new one. The old rows stay as they were.

        Every section comes back, so it is refused if that changes one the user may not edit.
        """
        serializer = ConfigRollbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            target = get_object_or_404(
                ConfigVersion.objects.exclude(status=Status.DRAFT), number=number
            )
            previous = appconfig.published()
            if previous and previous.pk == target.pk:
                raise appconfig.StaleDraft(f"Version {number} is already the published one.")
            _require_for_changes(request.user, previous, _sections(target))
            if previous:
                ConfigVersion.objects.filter(pk=previous.pk).update(status=Status.SUPERSEDED)
            row = ConfigVersion.objects.create(
                number=(ConfigVersion.objects.aggregate(m=Max("number"))["m"] or 0) + 1,
                status=Status.PUBLISHED,
                note=serializer.validated_data["note"].strip()
                or f"Rolled back to version {number}",
                created_by=request.user,
                **_sections(target),
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

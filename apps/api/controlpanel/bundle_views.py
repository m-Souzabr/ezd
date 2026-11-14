"""Export, import and reset of a configuration, the dry run, and the diff of two versions."""

from typing import Any

from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import appconfig, audit, catalogs, dryrun
from .catalog_views import _store as store_catalog_draft
from .codes import CATALOG_EDIT, CATALOG_PUBLISH
from .config_views import ANY_SECTION, CHECKS, SECTION_NAMES, SECTIONS, _sections, save_sections
from .conflict import conflict_extra
from .diff import diff
from .models import CatalogVersion, ConfigVersion
from .permissions import HasControlPanelPerm, can

FORMAT = "ezd-config"
FORMAT_VERSION = 1
# The names the Control Panel uses for the sections, and what each is stored as.
RESET_SECTIONS = {
    "app": "app_config",
    "rules": "rules_config",
    "quotes": "quote_defaults",
}
ANY_CONFIG = (*ANY_SECTION, CATALOG_EDIT)


class DraftExists(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "draft_exists"

    def __init__(self, detail: str, draft: Any) -> None:
        super().__init__(detail)
        self.extra = conflict_extra(draft)


class InvalidImport(APIException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "The file is not a valid configuration export."
    default_code = "invalid_import"

    def __init__(self, errors: list[dict[str, str]]) -> None:
        super().__init__()
        self.errors = errors


# --- export -----------------------------------------------------------------------------


class ExportSerializer(serializers.Serializer):
    format = serializers.CharField()
    formatVersion = serializers.IntegerField()
    config = serializers.JSONField(required=False)
    catalog = serializers.JSONField(required=False)


class ConfigExportView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = ANY_CONFIG

    @extend_schema(
        parameters=[
            OpenApiParameter("number", int, description="A config version. Default: published."),
            OpenApiParameter("catalog", str, description="A catalog version. Default: current."),
        ],
        responses={200: ExportSerializer},
    )
    def get(self, request: Request) -> Response:
        """A published version of every section as one JSON file.

        A section is left out for a user who may not read it, so an export never shows more
        than the pages do.
        """
        params = request.query_params
        if params.get("number") is not None:
            if not params["number"].isdigit():
                raise serializers.ValidationError({"number": "Expected a version number."})
            row = get_object_or_404(
                ConfigVersion.objects.exclude(status=ConfigVersion.Status.DRAFT),
                number=int(params["number"]),
            )
        else:
            row = appconfig.published()
        body: dict[str, Any] = {"format": FORMAT, "formatVersion": FORMAT_VERSION}
        sections = {
            name: getattr(row, name) if row else {}
            for name, code in SECTIONS.items()
            if can(request.user, code)
        }
        if sections:
            body["config"] = {"number": row.number if row else None, **sections}
        if can(request.user, CATALOG_EDIT):
            if params.get("catalog"):
                catalog = catalogs.catalog_for_version(params["catalog"])
                if catalog is None:
                    raise Http404
            else:
                catalog = catalogs.published_catalog()
            body["catalog"] = catalog
        audit.record(
            request.user,
            "config.export",
            "config_bundle",
            row.number if row else "",
            after={"sections": [k for k in body if k in ("config", "catalog")]},
        )
        response = Response(body)
        stamp = row.number if row else "defaults"
        response["Content-Disposition"] = f'attachment; filename="ezd-config-{stamp}.json"'
        return response


# --- import -----------------------------------------------------------------------------


class ImportSerializer(serializers.Serializer):
    data = serializers.JSONField()
    # Replace a draft that has unpublished changes. Without it, a draft is never overwritten.
    replace = serializers.BooleanField(default=False)


class ImportResultSerializer(serializers.Serializer):
    sections = serializers.ListField(child=serializers.CharField())
    config_revision = serializers.IntegerField(allow_null=True)
    catalog_revision = serializers.IntegerField(allow_null=True)


def _read_bundle(data: Any) -> tuple[dict[str, Any], Any | None]:
    """The config sections and the catalog in an export, or raises `InvalidImport`."""
    problems: list[dict[str, str]] = []
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise InvalidImport([{"path": "format", "message": f'Expected "{FORMAT}".'}])
    if data.get("formatVersion") != FORMAT_VERSION:
        raise InvalidImport(
            [{"path": "formatVersion", "message": f"Expected version {FORMAT_VERSION}."}]
        )
    config = data.get("config")
    values: dict[str, Any] = {}
    if config is not None:
        if not isinstance(config, dict):
            problems.append({"path": "config", "message": "Expected an object."})
        else:
            values = {name: config[name] for name in SECTIONS if name in config}
    catalog = data.get("catalog")
    if catalog is not None and not isinstance(catalog, dict):
        problems.append({"path": "catalog", "message": "Expected an object."})
    if problems:
        raise InvalidImport(problems)
    if not values and catalog is None:
        raise InvalidImport([{"path": "", "message": "The file has no configuration in it."}])
    return values, catalog


class ConfigImportView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = {"POST": ANY_CONFIG}
    # An export is the catalog, the three sections and a logo of at most 150 KB.
    max_body_bytes = 2 * 1024 * 1024

    @extend_schema(request=ImportSerializer, responses={200: ImportResultSerializer})
    def post(self, request: Request) -> Response:
        """Checks a file made by the export and saves what it holds as the draft.

        Nothing is published. Every section is checked before any is saved, so a file with
        one invalid section changes nothing, and the sections need their own permissions.
        """
        serializer = ImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        replace = serializer.validated_data["replace"]
        values, catalog = _read_bundle(serializer.validated_data["data"])
        for name in values:
            if not can(request.user, SECTIONS[name]):
                raise PermissionDenied(f"You do not have permission to edit {SECTION_NAMES[name]}.")
        if catalog is not None and not can(request.user, CATALOG_EDIT):
            raise PermissionDenied("You do not have permission to edit the catalog.")
        checked = {name: CHECKS[name](value) for name, value in values.items()}
        stored_catalog = catalogs.check_structure(catalog) if catalog is not None else None

        with transaction.atomic():
            config_revision = catalog_revision = None
            if checked:
                row = appconfig.draft()
                if row and not replace:
                    raise DraftExists(
                        "There is a draft of the configuration. Replace it, or publish it first.",
                        row,
                    )
                saved = save_sections(request.user, row.revision if row else 0, checked)
                config_revision = saved.revision
            if stored_catalog is not None:
                row = catalogs.draft()
                if row and not replace:
                    raise DraftExists(
                        "There is a draft of the catalog. Replace it, or publish it first.", row
                    )
                saved_catalog = store_catalog_draft(
                    request.user, row.revision if row else 0, stored_catalog
                )
                catalog_revision = saved_catalog.revision
        sections = [*checked, *(["catalog"] if stored_catalog is not None else [])]
        audit.record(
            request.user,
            "config.import",
            "config_bundle",
            "",
            after={"sections": sections, "replaced": replace},
        )
        return Response(
            {
                "sections": sections,
                "config_revision": config_revision,
                "catalog_revision": catalog_revision,
            }
        )


# --- reset ------------------------------------------------------------------------------


class ResetSerializer(serializers.Serializer):
    section = serializers.ChoiceField(choices=[*RESET_SECTIONS, "catalog"])
    # The revision of the draft the editor has loaded (0 if there is none).
    revision = serializers.IntegerField(min_value=0)


class ConfigResetView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = {"POST": ANY_CONFIG}

    @extend_schema(request=ResetSerializer, responses={200: ImportResultSerializer})
    def post(self, request: Request) -> Response:
        """Saves the compiled-in defaults of one section as the draft. Nothing is published."""
        serializer = ResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        section = serializer.validated_data["section"]
        revision = serializer.validated_data["revision"]
        if section == "catalog":
            if not can(request.user, CATALOG_EDIT):
                raise PermissionDenied("You do not have permission to edit the catalog.")
            row = store_catalog_draft(request.user, revision, catalogs.seed_catalog())
            result = {"config_revision": None, "catalog_revision": row.revision}
        else:
            name = RESET_SECTIONS[section]
            if not can(request.user, SECTIONS[name]):
                raise PermissionDenied(f"You do not have permission to edit {SECTION_NAMES[name]}.")
            config_row = save_sections(request.user, revision, {name: CHECKS[name]({})})
            result = {"config_revision": config_row.revision, "catalog_revision": None}
        audit.record(request.user, "config.reset", "config_bundle", section)
        return Response({"sections": [section], **result})


# --- dry run ----------------------------------------------------------------------------


class DryRunSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    sampled = serializers.IntegerField()
    changed = serializers.IntegerField()
    samples = serializers.ListField(child=serializers.DictField())


class DryRunResultSerializer(serializers.Serializer):
    designs = DryRunSerializer()
    quotes = DryRunSerializer()


class ConfigDryRunView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = ANY_SECTION

    @extend_schema(request=None, responses={200: DryRunResultSerializer})
    def post(self, request: Request) -> Response:
        """Which designs would be checked differently under the draft's rules."""
        draft = appconfig.draft()
        catalog = catalogs.published_catalog()
        after_rules = draft.rules_config if draft else appconfig.published_rules()
        report = dryrun.designs_report(
            {"catalog": catalog, "rules": appconfig.published_rules()},
            {"catalog": catalog, "rules": after_rules},
        )
        return Response({"designs": report, "quotes": dryrun.quotes_report(None)})


class CatalogDryRunView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_PUBLISH

    @extend_schema(request=None, responses={200: DryRunResultSerializer})
    def post(self, request: Request) -> Response:
        """Which designs and quotes the draft catalog would change."""
        draft = catalogs.draft()
        current = catalogs.published_catalog()
        proposed = draft.catalog if draft else current
        rules = appconfig.published_rules()
        report = dryrun.designs_report(
            {"catalog": current, "rules": rules}, {"catalog": proposed, "rules": rules}
        )
        return Response({"designs": report, "quotes": dryrun.quotes_report(proposed)})


# --- the difference between two versions ------------------------------------------------


class ChangeSerializer(serializers.Serializer):
    path = serializers.CharField()
    kind = serializers.ChoiceField(choices=("added", "removed", "changed"))
    before = serializers.JSONField(required=False)
    after = serializers.JSONField(required=False)


class VersionDiffSerializer(serializers.Serializer):
    # Each section's changes: app_config, rules_config, quote_defaults, or catalog.
    sections = serializers.DictField(child=ChangeSerializer(many=True))


def _version_number(request: Request, name: str) -> int:
    value = request.query_params.get(name, "")
    if not value.isdigit():
        raise serializers.ValidationError({name: "Expected a version number."})
    return int(value)


class ConfigVersionDiffView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = ANY_SECTION

    @extend_schema(
        parameters=[
            OpenApiParameter("from", int, required=True),
            OpenApiParameter("to", int, required=True),
        ],
        responses={200: VersionDiffSerializer},
    )
    def get(self, request: Request) -> Response:
        """What changed between two published versions, section by section.

        Only the sections the user may edit are compared.
        """
        rows = {}
        for key in ("from", "to"):
            rows[key] = get_object_or_404(
                ConfigVersion.objects.exclude(status=ConfigVersion.Status.DRAFT),
                number=_version_number(request, key),
            )
        before, after = _sections(rows["from"]), _sections(rows["to"])
        return Response(
            {
                "sections": {
                    name: diff(before[name], after[name])
                    for name, code in SECTIONS.items()
                    if can(request.user, code)
                }
            }
        )


class CatalogVersionDiffView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_EDIT

    @extend_schema(
        parameters=[
            OpenApiParameter("from", int, required=True),
            OpenApiParameter("to", int, required=True),
        ],
        responses={200: VersionDiffSerializer},
    )
    def get(self, request: Request) -> Response:
        """What changed between two published catalog versions, by entry and finish id."""
        rows = {}
        for key in ("from", "to"):
            rows[key] = get_object_or_404(
                CatalogVersion.objects.filter(status=CatalogVersion.Status.PUBLISHED),
                number=_version_number(request, key),
            )
        before = {k: v for k, v in rows["from"].catalog.items() if k != "version"}
        after = {k: v for k, v in rows["to"].catalog.items() if k != "version"}
        return Response({"sections": {"catalog": diff(before, after)}})

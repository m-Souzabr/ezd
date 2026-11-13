import copy
from collections.abc import Callable
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F
from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import audit, catalogs
from .catalogs import CatalogConflict, StaleCatalogDraft
from .codes import CATALOG_EDIT, CATALOG_PUBLISH
from .models import CatalogVersion
from .permissions import HasControlPanelPerm
from .serializers import (
    CatalogDraftSerializer,
    CatalogDraftUpdateSerializer,
    CatalogEntryChangeSerializer,
    CatalogEntryCreateSerializer,
    CatalogFinishCreateSerializer,
    CatalogPublishSerializer,
    CatalogRevisionSerializer,
    CatalogRollbackSerializer,
    CatalogSerializer,
    CatalogValidateSerializer,
    CatalogValidationSerializer,
    CatalogVersionSerializer,
)

Status = CatalogVersion.Status
OBJECT_TYPE = "catalog_version"
CURRENT_MAX_AGE_SECONDS = 30
# A published version never changes, so its URL may be cached for as long as anyone likes.
VERSIONED_CACHE = "public, max-age=31536000, immutable"


class PublicCatalogView(APIView):
    """The published catalog. Anyone may read it: the editor at `/` needs no session."""

    permission_classes = (AllowAny,)
    # No session is read, so the answer does not vary by cookie and may be cached.
    authentication_classes = ()

    @extend_schema(responses={200: CatalogSerializer})
    def get(self, request: Request) -> Response:
        catalog = catalogs.published_catalog()
        response = Response({"version": catalog["version"], "catalog": catalog})
        response["Cache-Control"] = f"public, max-age={CURRENT_MAX_AGE_SECONDS}"
        return response


class PublicCatalogVersionView(APIView):
    """One published version, for a design or quote that was made with an older catalog."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: CatalogSerializer})
    def get(self, request: Request, version: str) -> Response:
        catalog = catalogs.catalog_for_version(version)
        if catalog is None:
            raise Http404
        response = Response({"version": catalog["version"], "catalog": catalog})
        response["Cache-Control"] = VERSIONED_CACHE
        return response


def _draft_payload(row: CatalogVersion | None) -> dict[str, Any]:
    base = catalogs.published()
    based_on = base.version if base else catalogs.seed_catalog()["version"]
    if row is None:
        return {
            "revision": 0,
            "catalog": catalogs.published_catalog(),
            "based_on": based_on,
            "updated_at": None,
        }
    return {
        "revision": row.revision,
        "catalog": row.catalog,
        "based_on": based_on,
        "updated_at": row.updated_at,
    }


def _working_copy(revision: int) -> dict[str, Any]:
    """The catalog the editor loaded at `revision`, to change: a copy, never the row."""
    row = catalogs.draft()
    if revision == 0:
        if row is not None:
            raise StaleCatalogDraft()
        return copy.deepcopy(catalogs.published_catalog())
    if row is None or row.revision != revision:
        raise StaleCatalogDraft()
    return copy.deepcopy(row.catalog)


def _store(user: Any, revision: int, catalog: dict[str, Any]) -> CatalogVersion:
    """Saves the draft if `revision` is still the saved one, else 409.

    One UPDATE on the row's own columns, so two saves cannot both succeed.
    """
    if revision == 0:
        try:
            with transaction.atomic():
                return CatalogVersion.objects.create(
                    status=Status.DRAFT, catalog=catalog, created_by=user
                )
        except IntegrityError as error:
            raise StaleCatalogDraft() from error
    changed = CatalogVersion.objects.filter(status=Status.DRAFT, revision=revision).update(
        catalog=catalog, revision=F("revision") + 1
    )
    if not changed:
        raise StaleCatalogDraft()
    row = catalogs.draft()
    assert row is not None
    return row


class CatalogDraftView(APIView):
    """The catalog being edited. Without a saved draft it is the published one."""

    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_EDIT

    @extend_schema(responses={200: CatalogDraftSerializer})
    def get(self, request: Request) -> Response:
        return Response(_draft_payload(catalogs.draft()))

    @extend_schema(request=CatalogDraftUpdateSerializer, responses={200: CatalogDraftSerializer})
    def put(self, request: Request) -> Response:
        """Saves the draft if `revision` is the one the editor loaded, else 409.

        A draft may break the catalog's rules (it is work in progress) but it must be a
        catalog: publishing is what checks the rules.
        """
        serializer = CatalogDraftUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        revision = serializer.validated_data["revision"]
        catalog = catalogs.check_structure(serializer.validated_data["catalog"])
        row = _store(request.user, revision, catalog)
        audit.record(
            request.user,
            "catalog.draft.save",
            OBJECT_TYPE,
            row.pk,
            before={"revision": revision},
            after={"revision": row.revision, "entries": len(catalog["entries"])},
        )
        return Response(_draft_payload(row))


class CatalogValidateView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_EDIT

    @extend_schema(request=CatalogValidateSerializer, responses={200: CatalogValidationSerializer})
    def post(self, request: Request) -> Response:
        """Every problem with a catalog (the draft unless given one), as publishing finds them."""
        serializer = CatalogValidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if "catalog" in serializer.validated_data:
            catalog = serializer.validated_data["catalog"]
        else:
            catalog = _draft_payload(catalogs.draft())["catalog"]
        found = catalogs.problems(catalog)
        return Response({"ok": not found, "problems": found})


class CatalogPublishView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_PUBLISH

    @extend_schema(request=CatalogPublishSerializer, responses={200: CatalogVersionSerializer})
    def post(self, request: Request) -> Response:
        """Checks every rule, then makes the draft the next published version, for good."""
        serializer = CatalogPublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            draft = CatalogVersion.objects.select_for_update().filter(status=Status.DRAFT).first()
            if draft is None or draft.revision != serializer.validated_data["revision"]:
                raise StaleCatalogDraft()
            catalogs.validate_for_publish(draft.catalog)
            previous = catalogs.published()
            number = catalogs.next_number()
            version = catalogs.version_name(number)
            draft.number = number
            draft.version = version
            draft.status = Status.PUBLISHED
            draft.catalog = {**draft.catalog, "version": version}
            draft.note = serializer.validated_data["note"].strip()
            draft.created_by = request.user
            draft.save()
        audit.record(
            request.user,
            "catalog.publish",
            OBJECT_TYPE,
            draft.pk,
            before={"version": previous.version if previous else None},
            after={"version": version, "note": draft.note},
        )
        return Response(_version_row(draft, current=True))


def _version_row(row: CatalogVersion, current: bool) -> dict[str, Any]:
    return {
        "number": row.number,
        "version": row.version,
        "current": current,
        "note": row.note,
        "created_by": row.created_by.email if row.created_by else "",
        "created_at": row.created_at,
    }


class CatalogVersionListView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_EDIT
    pagination_class = None

    @extend_schema(responses={200: CatalogVersionSerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = list(
            CatalogVersion.objects.filter(status=Status.PUBLISHED)
            .select_related("created_by")
            .order_by("-number")
        )
        return Response([_version_row(row, current=index == 0) for index, row in enumerate(rows)])


class CatalogRollbackView(APIView):
    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_PUBLISH

    @extend_schema(request=CatalogRollbackSerializer, responses={200: CatalogVersionSerializer})
    def post(self, request: Request, version: str) -> Response:
        """Publishes a copy of an old version as a new one. The old rows stay as they were."""
        serializer = CatalogRollbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            target = catalogs.version_row(version)
            if target is None:
                raise Http404
            previous = catalogs.published()
            if previous and previous.pk == target.pk:
                raise CatalogConflict(f"Version {version} is already the published one.")
            number = catalogs.next_number()
            name = catalogs.version_name(number)
            row = CatalogVersion.objects.create(
                number=number,
                version=name,
                status=Status.PUBLISHED,
                catalog={**target.catalog, "version": name},
                note=serializer.validated_data["note"].strip() or f"Rolled back to {version}",
                created_by=request.user,
            )
        audit.record(
            request.user,
            "catalog.rollback",
            OBJECT_TYPE,
            row.pk,
            before={"version": previous.version if previous else None},
            after={"version": name, "restored_from": version},
        )
        return Response(_version_row(row, current=True))


# --- entries and finishes, one at a time ------------------------------------------------


def _find(catalog: dict[str, Any], collection: str, item_id: str) -> dict[str, Any]:
    found = next((item for item in catalog[collection] if item["id"] == item_id), None)
    if found is None:
        raise Http404
    return found


def _object(value: Any, what: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise serializers.ValidationError({what: "Expected an object."})
    return value


class _Edit(APIView):
    """The shared part of every granular change: load the draft, change it, save, audit."""

    permission_classes = (HasControlPanelPerm,)
    control_panel_perm = CATALOG_EDIT
    collection = "entries"
    noun = "entry"

    def edit(
        self,
        request: Request,
        revision: int,
        action: str,
        change: Callable[[dict[str, Any]], tuple[Any, Any, str]],
    ) -> Response:
        """`change` mutates the working copy and returns (before, after, id)."""
        catalog = _working_copy(revision)
        before, after, item_id = change(catalog)
        stored = catalogs.check_structure(catalog)
        row = _store(request.user, revision, stored)
        audit.record(
            request.user,
            f"catalog.{self.noun}.{action}",
            OBJECT_TYPE,
            row.pk,
            before={"id": item_id, self.noun: before},
            after={"id": item_id, self.noun: after},
        )
        return Response(_draft_payload(row))

    def create(self, request: Request, revision: int, item: Any) -> Response:
        item = _object(item, self.noun)

        def change(catalog: dict[str, Any]) -> tuple[Any, Any, str]:
            item_id = item.get("id")
            if not isinstance(item_id, str) or not item_id.strip():
                raise serializers.ValidationError({self.noun: "Give it an id."})
            if any(other["id"] == item_id for other in catalog[self.collection]):
                raise CatalogConflict(f'There is already a {self.noun} "{item_id}".')
            catalog[self.collection].append(item)
            return None, item, item_id

        return self.edit(request, revision, "create", change)

    def patch(self, request: Request, revision: int, item_id: str, changes: Any) -> Response:
        changes = _object(changes, "changes")
        if "id" in changes:
            raise serializers.ValidationError({"changes": "An id cannot be changed."})

        def change(catalog: dict[str, Any]) -> tuple[Any, Any, str]:
            item = _find(catalog, self.collection, item_id)
            before = copy.deepcopy(item)
            for key, value in changes.items():
                if value is None:
                    item.pop(key, None)
                else:
                    item[key] = value
            return before, copy.deepcopy(item), item_id

        return self.edit(request, revision, "update", change)

    def flag(self, request: Request, revision: int, item_id: str, retire: bool) -> Response:
        """Retires or restores. Nothing is ever deleted."""

        def change(catalog: dict[str, Any]) -> tuple[Any, Any, str]:
            item = _find(catalog, self.collection, item_id)
            before = copy.deepcopy(item)
            if retire:
                item["retired"] = True
            else:
                item.pop("retired", None)
            return before, copy.deepcopy(item), item_id

        return self.edit(request, revision, "retire" if retire else "restore", change)


class CatalogEntryListView(_Edit):
    @extend_schema(request=CatalogEntryCreateSerializer, responses={200: CatalogDraftSerializer})
    def post(self, request: Request) -> Response:
        """Adds an entry to the draft."""
        serializer = CatalogEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.create(
            request, serializer.validated_data["revision"], serializer.validated_data["entry"]
        )


class CatalogEntryDetailView(_Edit):
    @extend_schema(request=CatalogEntryChangeSerializer, responses={200: CatalogDraftSerializer})
    def patch(self, request: Request, entry_id: str) -> Response:  # type: ignore[override]
        """Replaces the given fields of an entry of the draft."""
        serializer = CatalogEntryChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        return super().patch(request, data["revision"], entry_id, data["changes"])


class CatalogEntryRetireView(_Edit):
    @extend_schema(request=CatalogRevisionSerializer, responses={200: CatalogDraftSerializer})
    def post(self, request: Request, entry_id: str) -> Response:
        serializer = CatalogRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.flag(request, serializer.validated_data["revision"], entry_id, retire=True)


class CatalogEntryRestoreView(_Edit):
    @extend_schema(request=CatalogRevisionSerializer, responses={200: CatalogDraftSerializer})
    def post(self, request: Request, entry_id: str) -> Response:
        serializer = CatalogRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.flag(request, serializer.validated_data["revision"], entry_id, retire=False)


class _FinishEdit(_Edit):
    collection = "finishes"
    noun = "finish"


class CatalogFinishListView(_FinishEdit):
    @extend_schema(request=CatalogFinishCreateSerializer, responses={200: CatalogDraftSerializer})
    def post(self, request: Request) -> Response:
        """Adds a finish to the draft."""
        serializer = CatalogFinishCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.create(
            request, serializer.validated_data["revision"], serializer.validated_data["finish"]
        )


class CatalogFinishDetailView(_FinishEdit):
    @extend_schema(request=CatalogEntryChangeSerializer, responses={200: CatalogDraftSerializer})
    def patch(self, request: Request, finish_id: str) -> Response:  # type: ignore[override]
        """Replaces the given fields of a finish of the draft."""
        serializer = CatalogEntryChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        return super().patch(request, data["revision"], finish_id, data["changes"])


class CatalogFinishRetireView(_FinishEdit):
    @extend_schema(request=CatalogRevisionSerializer, responses={200: CatalogDraftSerializer})
    def post(self, request: Request, finish_id: str) -> Response:
        serializer = CatalogRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.flag(request, serializer.validated_data["revision"], finish_id, retire=True)


class CatalogFinishRestoreView(_FinishEdit):
    @extend_schema(request=CatalogRevisionSerializer, responses={200: CatalogDraftSerializer})
    def post(self, request: Request, finish_id: str) -> Response:
        serializer = CatalogRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self.flag(request, serializer.validated_data["revision"], finish_id, retire=False)

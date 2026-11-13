import uuid
from typing import Any

from django.db import transaction
from django.db.models import F, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .documents import empty_document, validate_document
from .models import Design, DesignVersion, Project, snapshot_draft
from .serializers import (
    DesignCreateSerializer,
    DesignSerializer,
    DesignSummarySerializer,
    DesignVersionCreateSerializer,
    DesignVersionSerializer,
    DesignVersionSummarySerializer,
    DraftConflictSerializer,
    DraftSavedSerializer,
    DraftSaveSerializer,
    InvalidDocumentSerializer,
    ProjectSerializer,
)

DEFAULT_DESIGN_NAME = "Untitled kitchen"


# Scopes every query of a view to the signed-in user. A view names its model and reads rows
# only through `get_queryset` or `owned`, so a row of another account is not found and the
# answer is a 404, never a 403. (A comment, not a docstring: drf-spectacular would copy a
# docstring into the description of every endpoint.)
class OwnedQuerysetMixin:
    model: Any
    request: Request

    def get_queryset(self) -> QuerySet[Any]:
        return self.owned(self.model)

    def owned(self, model: Any) -> QuerySet[Any]:
        return model.objects.for_user(self.request.user)


class ProjectListView(OwnedQuerysetMixin, generics.ListCreateAPIView):
    """The user's projects that are not archived, newest first."""

    model = Project
    serializer_class = ProjectSerializer

    def perform_create(self, serializer: Any) -> None:
        serializer.save(owner=self.request.user)


class ProjectDetailView(OwnedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """Read, rename, or archive. An archived project and its designs are no longer found."""

    model = Project
    serializer_class = ProjectSerializer
    http_method_names = ("get", "patch", "delete", "head", "options")

    def perform_destroy(self, instance: Project) -> None:
        """Archives the project. Its designs are kept but no longer reachable."""
        instance.archived_at = timezone.now()
        instance.save(update_fields=["archived_at", "updated_at"])


class ProjectDesignListView(OwnedQuerysetMixin, generics.ListAPIView):
    """The designs of a project, without their documents."""

    model = Design
    serializer_class = DesignSummarySerializer

    def get_queryset(self) -> QuerySet[Design]:
        project = get_object_or_404(self.owned(Project), pk=self.kwargs["pk"])
        return super().get_queryset().filter(project=project).defer("draft_document")

    @extend_schema(
        request=DesignCreateSerializer,
        responses={201: DesignSerializer, 422: InvalidDocumentSerializer},
    )
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Creates a design from `document`, or an empty one."""
        project = get_object_or_404(self.owned(Project), pk=pk)
        serializer = DesignCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        given = serializer.validated_data.get("document")
        name = serializer.validated_data.get("name")
        if name is None:
            given_name = given.get("name") if given else None
            name = given_name if isinstance(given_name, str) and given_name else DEFAULT_DESIGN_NAME

        design_id = uuid.uuid4()
        document = (
            {**given, "id": str(design_id)}
            if given is not None
            else empty_document(str(design_id), name)
        )
        validate_document(document, str(design_id))
        design = Design.objects.create(
            id=design_id,
            project=project,
            name=name,
            draft_document=document,
            schema_version=document["schemaVersion"],
        )
        return Response(DesignSerializer(design).data, status=status.HTTP_201_CREATED)


class DesignDetailView(OwnedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """Read with the draft document, rename, or delete with every snapshot."""

    model = Design
    serializer_class = DesignSerializer
    http_method_names = ("get", "patch", "delete", "head", "options")


class DesignDraftView(OwnedQuerysetMixin, APIView):
    model = Design

    @extend_schema(
        request=DraftSaveSerializer,
        responses={
            200: DraftSavedSerializer,
            409: DraftConflictSerializer,
            422: InvalidDocumentSerializer,
        },
    )
    def put(self, request: Request, pk: uuid.UUID) -> Response:
        """Autosave. Stores `document` only if the draft is still at `base_revision`."""
        get_object_or_404(self.get_queryset().only("id"), pk=pk)
        serializer = DraftSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = validate_document(serializer.validated_data["document"], str(pk))
        base = serializer.validated_data["base_revision"]

        # The comparison and the write are one statement, so of two saves from the same
        # base exactly one matches a row. The filter is on the design's own columns only:
        # with the join to the owner, Django would compare the revision in a subquery,
        # which the second of two concurrent saves does not check again after its wait.
        # Ownership was established by the lookup above.
        now = timezone.now()
        saved = Design.objects.filter(pk=pk, draft_revision=base).update(
            draft_document=document,
            draft_revision=F("draft_revision") + 1,
            schema_version=document["schemaVersion"],
            updated_at=now,
        )
        if saved:
            return Response({"draft_revision": base + 1, "updated_at": now})
        current = get_object_or_404(self.get_queryset().only("draft_revision", "updated_at"), pk=pk)
        return Response(
            {
                "detail": "The design was changed elsewhere since this revision.",
                "draft_revision": current.draft_revision,
                "updated_at": current.updated_at,
            },
            status=status.HTTP_409_CONFLICT,
        )


class DesignVersionListView(OwnedQuerysetMixin, generics.ListAPIView):
    """The snapshots of a design, newest first, without their documents."""

    model = DesignVersion
    serializer_class = DesignVersionSummarySerializer

    def get_queryset(self) -> QuerySet[DesignVersion]:
        design = get_object_or_404(self.owned(Design).only("id"), pk=self.kwargs["pk"])
        return super().get_queryset().filter(design=design).defer("document")

    @extend_schema(
        request=DesignVersionCreateSerializer, responses={201: DesignVersionSummarySerializer}
    )
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Snapshots the current draft as the next version of the design."""
        serializer = DesignVersionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            design = get_object_or_404(self.owned(Design).select_for_update(of=("self",)), pk=pk)
            version = snapshot_draft(design, request.user, serializer.validated_data["label"])
        return Response(
            DesignVersionSummarySerializer(version).data, status=status.HTTP_201_CREATED
        )


class DesignVersionDetailView(OwnedQuerysetMixin, generics.RetrieveAPIView):
    """One snapshot with its document."""

    model = DesignVersion
    serializer_class = DesignVersionSerializer

    def get_object(self) -> DesignVersion:
        return get_object_or_404(
            self.get_queryset(), design_id=self.kwargs["pk"], number=self.kwargs["number"]
        )


class DesignVersionRestoreView(OwnedQuerysetMixin, APIView):
    model = DesignVersion

    @extend_schema(request=None, responses={200: DesignSerializer})
    def post(self, request: Request, pk: uuid.UUID, number: int) -> Response:
        """Copies the snapshot into the draft, as a new revision. The snapshot is kept."""
        with transaction.atomic():
            design = get_object_or_404(self.owned(Design).select_for_update(of=("self",)), pk=pk)
            version = get_object_or_404(self.get_queryset(), design=design, number=number)
            design.draft_document = version.document
            design.schema_version = version.schema_version
            design.draft_revision += 1
            design.save(
                update_fields=["draft_document", "schema_version", "draft_revision", "updated_at"]
            )
        return Response(DesignSerializer(design).data)

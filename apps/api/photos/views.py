import uuid
from typing import Any

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import QuerySet
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from chat.usage import check_quota, record_usage
from config.api import LLMThrottledMixin, UploadThrottledMixin
from controlpanel import catalogs
from llm import config
from llm.client import LLMUnavailable
from projects.documents import InvalidDocument, validate_document
from projects.models import Design, Project, snapshot_draft
from projects.serializers import DesignSerializer, InvalidDocumentSerializer
from projects.views import DEFAULT_DESIGN_NAME, OwnedQuerysetMixin

from .analysis import AnalysisAttempt, analyze, core
from .images import InvalidPhoto, process_upload
from .models import Photo, PhotoDraft
from .serializers import (
    PhotoDraftConfirmSerializer,
    PhotoDraftSerializer,
    PhotoDraftUpdateSerializer,
    PhotoSerializer,
    PhotoUploadSerializer,
)

# Room for the multipart envelope around a photo of the largest accepted size.
MULTIPART_OVERHEAD_BYTES = 64 * 1024


class DraftNotEditable(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "draft_not_editable"


class DraftUnavailable(APIException):
    """Problems the server could not check: `ezd-core` did not run."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Drafts cannot be checked right now."
    default_code = "validation_unavailable"


def _not_editable(draft: PhotoDraft) -> DraftNotEditable:
    return DraftNotEditable(
        {
            PhotoDraft.Status.CONFIRMED: "This draft was already confirmed.",
            PhotoDraft.Status.DISCARDED: "This draft was discarded.",
            PhotoDraft.Status.FAILED: "The analysis of this photo failed. Analyze it again.",
            PhotoDraft.Status.ANALYZING: "This photo is still being analyzed.",
        }.get(draft.status, "This draft cannot be changed.")
    )


class ProjectPhotoListView(UploadThrottledMixin, OwnedQuerysetMixin, generics.ListAPIView):
    """The photos of a project, newest first, with the state of their newest analysis."""

    model = Photo
    serializer_class = PhotoSerializer
    parser_classes = (MultiPartParser,)
    max_body_bytes = settings.PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES

    def get_queryset(self) -> QuerySet[Photo]:
        project = get_object_or_404(self.owned(Project), pk=self.kwargs["pk"])
        return super().get_queryset().filter(project=project).prefetch_related("drafts")

    @extend_schema(
        request={"multipart/form-data": PhotoUploadSerializer}, responses={201: PhotoSerializer}
    )
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Uploads a JPEG, PNG or WebP photo. It is stored re-encoded, with no metadata."""
        project = get_object_or_404(self.owned(Project), pk=pk)
        serializer = PhotoUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        if upload.size > settings.PHOTO_MAX_BYTES:
            raise ValidationError(
                {"file": [f"The photo is larger than {settings.PHOTO_MAX_BYTES // 2**20} MB."]}
            )
        try:
            processed = process_upload(upload.read())
        except InvalidPhoto as error:
            raise ValidationError({"file": [str(error)]}) from error
        photo = Photo(
            owner=request.user,
            project=project,
            width=processed.width,
            height=processed.height,
            bytes=len(processed.content),
        )
        photo.file.save("photo.jpg", ContentFile(processed.content), save=False)
        photo.save()
        return Response(PhotoSerializer(photo).data, status=status.HTTP_201_CREATED)


class PhotoDetailView(OwnedQuerysetMixin, generics.RetrieveDestroyAPIView):
    """Read, or delete with its file and drafts. Designs made from it are kept."""

    model = Photo
    serializer_class = PhotoSerializer

    def get_queryset(self) -> QuerySet[Photo]:
        return super().get_queryset().prefetch_related("drafts")


class PhotoFileView(OwnedQuerysetMixin, APIView):
    model = Photo

    @extend_schema(responses={(200, "image/jpeg"): OpenApiTypes.BINARY})
    def get(self, request: Request, pk: uuid.UUID) -> FileResponse:
        """The photo itself, as a JPEG. Only its owner can read it."""
        photo = get_object_or_404(self.get_queryset(), pk=pk)
        response = FileResponse(photo.file.open("rb"), content_type="image/jpeg")
        response["Cache-Control"] = "private, max-age=3600"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class PhotoAnalyzeView(LLMThrottledMixin, OwnedQuerysetMixin, APIView):
    model = Photo

    @extend_schema(request=None, responses={201: PhotoDraftSerializer})
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Runs the vision model on the photo and stores a new draft: `ready` or `failed`."""
        photo = get_object_or_404(self.get_queryset(), pk=pk)
        check_quota(request.user)
        client = config.get_client(settings.LLM_PHOTO_TIMEOUT_SECONDS)
        models = config.models()
        draft = PhotoDraft.objects.create(photo=photo)
        with photo.file.open("rb") as file:
            image = file.read()

        def charge(attempt: AnalysisAttempt) -> None:
            record_usage(request.user, attempt.usage)
            draft.input_tokens += attempt.usage.input_tokens
            draft.output_tokens += attempt.usage.output_tokens

        # v1 runs the analysis inside the request, which takes up to
        # LLM_PHOTO_TIMEOUT_SECONDS per attempt. A task queue would take over from here:
        # the view would return the draft while `analyzing` and the browser would poll it.
        try:
            result = analyze(
                client,
                image,
                config.vision_model(),
                models.escalation,
                on_attempt=charge,
                catalog=catalogs.published_catalog(),
            )
        except LLMUnavailable as error:
            draft.status = PhotoDraft.Status.FAILED
            draft.error = str(error)
        except ValueError:
            draft.status = PhotoDraft.Status.FAILED
            draft.error = "The draft could not be checked. Try again in a minute."
        else:
            draft.model_output = result.model_output
            draft.model = result.model
            if result.ok:
                draft.status = PhotoDraft.Status.READY
                draft.draft = result.draft
            else:
                draft.status = PhotoDraft.Status.FAILED
                draft.error = result.error
        draft.save()
        return Response(PhotoDraftSerializer(draft).data, status=status.HTTP_201_CREATED)


class PhotoDraftDetailView(OwnedQuerysetMixin, APIView):
    model = PhotoDraft

    @extend_schema(responses={200: PhotoDraftSerializer})
    def get(self, request: Request, pk: uuid.UUID) -> Response:
        draft = get_object_or_404(self.get_queryset(), pk=pk)
        return Response(PhotoDraftSerializer(draft).data)

    @extend_schema(request=PhotoDraftUpdateSerializer, responses={200: PhotoDraftSerializer})
    def patch(self, request: Request, pk: uuid.UUID) -> Response:
        """Saves the user's corrections. Only a `ready` draft can change."""
        get_object_or_404(self.get_queryset().only("id"), pk=pk)
        serializer = PhotoDraftUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            draft = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
            if draft.status != PhotoDraft.Status.READY:
                raise _not_editable(draft)
            draft.draft = serializer.validated_data["draft"]
            draft.save(update_fields=["draft", "updated_at"])
        return Response(PhotoDraftSerializer(draft).data)


class PhotoDraftConfirmView(OwnedQuerysetMixin, APIView):
    model = PhotoDraft

    @extend_schema(
        request=PhotoDraftConfirmSerializer,
        responses={201: DesignSerializer, 422: InvalidDocumentSerializer},
    )
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Creates the design and its version 1 from the confirmed draft. Once only."""
        get_object_or_404(self.get_queryset().only("id"), pk=pk)
        serializer = PhotoDraftConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        given = serializer.validated_data["document"]
        with transaction.atomic():
            draft = get_object_or_404(
                self.get_queryset().select_for_update(of=("self",)).select_related("photo"),
                pk=pk,
            )
            if draft.status != PhotoDraft.Status.READY:
                raise _not_editable(draft)
            # Every wall length must have been typed or confirmed, whatever the browser sent.
            try:
                checked = core("draft-problems", draft.draft)
            except ValueError as error:
                raise DraftUnavailable() from error
            problems = checked.get("problems") or []
            if not checked.get("ok"):
                messages = problems or [i.get("message", "") for i in checked.get("errors", [])]
                raise InvalidDocument([{"path": "draft", "message": m} for m in messages])

            design_id = uuid.uuid4()
            document = {**given, "id": str(design_id)}
            validate_document(document, str(design_id))
            name = serializer.validated_data.get("name") or _name(given)
            design = Design.objects.create(
                id=design_id,
                project_id=draft.photo.project_id,
                name=name,
                draft_document=document,
                schema_version=document["schemaVersion"],
            )
            snapshot_draft(design, request.user, label="From photo")
            draft.status = PhotoDraft.Status.CONFIRMED
            draft.design = design
            draft.save(update_fields=["status", "design", "updated_at"])
        return Response(DesignSerializer(design).data, status=status.HTTP_201_CREATED)


def _name(document: dict[str, Any]) -> str:
    name = document.get("name")
    return name if isinstance(name, str) and name else DEFAULT_DESIGN_NAME


class PhotoDraftDiscardView(OwnedQuerysetMixin, APIView):
    model = PhotoDraft

    @extend_schema(request=None, responses={200: PhotoDraftSerializer})
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Marks the draft discarded. A confirmed draft cannot be discarded."""
        with transaction.atomic():
            draft = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
            if draft.status == PhotoDraft.Status.CONFIRMED:
                raise _not_editable(draft)
            draft.status = PhotoDraft.Status.DISCARDED
            draft.save(update_fields=["status", "updated_at"])
        return Response(PhotoDraftSerializer(draft).data)

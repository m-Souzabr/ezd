import uuid

from django.db import transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.request import Request
from rest_framework.response import Response

from projects.models import Design, Project, snapshot_draft
from projects.views import OwnedQuerysetMixin

from .models import Quote
from .serializers import (
    InconsistentQuoteSerializer,
    QuoteCreateSerializer,
    QuoteSerializer,
    QuoteSummarySerializer,
    StaleDraftSerializer,
)


class DesignQuoteListView(OwnedQuerysetMixin, generics.ListAPIView):
    """The quotes of a design, newest first, without their lines and drawings."""

    model = Quote
    serializer_class = QuoteSummarySerializer
    # A new quote carries its drawings, so its body may be larger than a document.
    max_body_bytes = 12 * 1024 * 1024

    def get_queryset(self) -> QuerySet[Quote]:
        design = get_object_or_404(self.owned(Design).only("id"), pk=self.kwargs["pk"])
        return (
            super()
            .get_queryset()
            .filter(design_version__design=design)
            .select_related("design_version")
            .defer("lines", "drawings", "design_version__document")
        )

    @extend_schema(
        request=QuoteCreateSerializer,
        responses={
            201: QuoteSerializer,
            409: StaleDraftSerializer,
            422: InconsistentQuoteSerializer,
        },
    )
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        """Snapshots the draft as a new version of the design and stores the quote for it."""
        get_object_or_404(self.owned(Design).only("id"), pk=pk)
        serializer = QuoteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            design = get_object_or_404(self.owned(Design).select_for_update(of=("self",)), pk=pk)
            if design.draft_revision != data["draft_revision"]:
                return Response(
                    {
                        "detail": "The design was changed since this quote was computed.",
                        "draft_revision": design.draft_revision,
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            # The project row is locked for the number, which is never used twice.
            project = Project.objects.select_for_update().get(pk=design.project_id)
            project.last_quote_number += 1
            project.save(update_fields=["last_quote_number"])
            version = snapshot_draft(design, request.user, f"Quote {project.last_quote_number}")
            quote = Quote.objects.create(
                project=project,
                design_version=version,
                number=project.last_quote_number,
                customer_name=data["customer_name"],
                customer_email=data["customer_email"],
                customer_address=data["customer_address"],
                notes=data["notes"],
                catalog_version=data["catalog_version"],
                settings=data["settings"],
                lines=data["lines"],
                totals=data["totals"],
                drawings=data["drawings"],
                created_by=request.user,
            )
        return Response(QuoteSerializer(quote).data, status=status.HTTP_201_CREATED)


class QuoteDetailView(OwnedQuerysetMixin, generics.RetrieveDestroyAPIView):
    """One quote with everything needed to render its PDF, or delete it. Never changed."""

    model = Quote
    serializer_class = QuoteSerializer

    def get_queryset(self) -> QuerySet[Quote]:
        return (
            super()
            .get_queryset()
            .select_related("project", "design_version__design")
            .defer("design_version__document", "design_version__design__draft_document")
        )

from django.http import HttpRequest, JsonResponse
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response


@extend_schema(
    auth=[],
    responses=inline_serializer("Health", {"status": serializers.CharField()}),
)
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request: Request) -> Response:
    """Liveness probe. Does not touch the database."""
    return Response({"status": "ok"})


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    """A missing or wrong CSRF token, as JSON like every other API error."""
    return JsonResponse({"detail": f"CSRF check failed: {reason}"}, status=403)

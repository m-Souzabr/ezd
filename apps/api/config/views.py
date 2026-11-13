from django.db import DatabaseError, connection
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


@extend_schema(
    auth=[],
    responses={
        200: inline_serializer("Ready", {"status": serializers.CharField()}),
        503: inline_serializer("NotReady", {"status": serializers.CharField()}),
    },
)
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def ready(request: Request) -> Response:
    """Readiness probe: the API can reach its database."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        return Response({"status": "database unavailable"}, status=503)
    return Response({"status": "ok"})


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    """A missing or wrong CSRF token, as JSON like every other API error."""
    return JsonResponse({"detail": f"CSRF check failed: {reason}"}, status=403)

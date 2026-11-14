from django.db import DatabaseError, connection
from django.http import HttpRequest, JsonResponse
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from controlpanel import appconfig, catalogs


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
        200: inline_serializer(
            "Ready",
            {
                "status": serializers.CharField(),
                # `ok`, `defaults` (nothing published yet), `invalid` or `unknown`.
                "config": serializers.CharField(),
                "catalog": serializers.CharField(),
            },
        ),
        503: inline_serializer("NotReady", {"status": serializers.CharField()}),
    },
)
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def ready(request: Request) -> Response:
    """Readiness probe: the API can reach its database, and what the published config says."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        return Response({"status": "database unavailable"}, status=503)
    # The published configuration is reported but never fails the probe: a bad one falls
    # back to the defaults field by field, and the Control Panel must stay reachable to
    # roll it back.
    return Response({"status": "ok", "config": appconfig.health(), "catalog": catalogs.health()})


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    """A missing or wrong CSRF token, as JSON like every other API error."""
    return JsonResponse({"detail": f"CSRF check failed: {reason}"}, status=403)

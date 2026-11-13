from typing import Any

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import config
from .models import LLMSettings
from .secrets import encrypt
from .serializers import LLMSettingsSerializer, LLMSettingsUpdateSerializer


def _payload() -> dict[str, Any]:
    row = LLMSettings.load()
    key, source = config.api_key()
    current = config.models()
    return {
        "vendor": settings.LLM_VENDOR,
        "configured": bool(key) or settings.LLM_VENDOR == "fake",
        "key_source": source,
        "api_key_last4": row.api_key_last4 if source == "settings" else "",
        "models": vars(current),
        "default_models": {
            "router": settings.LLM_ROUTER_MODEL,
            "default": settings.LLM_DEFAULT_MODEL,
            "escalation": settings.LLM_ESCALATION_MODEL,
        },
        "updated_at": row.updated_at,
    }


class LLMSettingsView(APIView):
    """The assistant's API key and models, for the whole site. Staff only."""

    permission_classes = (IsAdminUser,)

    @extend_schema(responses={200: LLMSettingsSerializer})
    def get(self, request: Request) -> Response:
        return Response(_payload())

    @extend_schema(request=LLMSettingsUpdateSerializer, responses={200: LLMSettingsSerializer})
    def patch(self, request: Request) -> Response:
        """Stores the key encrypted. The answer shows only its last four characters."""
        serializer = LLMSettingsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        row = LLMSettings.load()
        if "api_key" in data:
            key = data["api_key"]
            row.encrypted_api_key = encrypt(key) if key else ""
            row.api_key_last4 = key[-4:] if key else ""
        for field in ("router_model", "default_model", "escalation_model"):
            if field in data:
                setattr(row, field, data[field].strip())
        row.updated_by = request.user
        row.save()
        return Response(_payload())

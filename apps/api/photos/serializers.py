import json
from functools import cache
from typing import Any

from django.conf import settings
from drf_spectacular.utils import extend_schema_field
from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match
from rest_framework import serializers

from .models import Photo, PhotoDraft

# A room draft is an open JSON object here. Its shape is checked against the JSON Schema
# that core generates (`room-draft.schema.json`).


@cache
def _room_draft_validator() -> Draft202012Validator:
    with open(settings.ROOM_DRAFT_SCHEMA_PATH, encoding="utf-8") as file:
        return Draft202012Validator(json.load(file))


class PhotoDraftSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = PhotoDraft
        fields = ("id", "status", "design", "created_at")
        read_only_fields = fields


class PhotoSerializer(serializers.ModelSerializer):
    # The newest analysis of the photo, or null before the first one.
    latest_draft = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = ("id", "project", "width", "height", "bytes", "latest_draft", "created_at")
        read_only_fields = fields

    @extend_schema_field(PhotoDraftSummarySerializer(allow_null=True))
    def get_latest_draft(self, photo: Photo) -> dict[str, Any] | None:
        # `drafts` is prefetched by the list view, newest first.
        draft = next(iter(photo.drafts.all()), None)
        return PhotoDraftSummarySerializer(draft).data if draft else None


class PhotoUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class PhotoDraftSerializer(serializers.ModelSerializer):
    # Core's `RoomDraft`, or null while analyzing and after a failure.
    draft = serializers.DictField(read_only=True, allow_null=True)

    class Meta:
        model = PhotoDraft
        fields = (
            "id",
            "photo",
            "status",
            "draft",
            "error",
            "design",
            "model",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class PhotoDraftUpdateSerializer(serializers.Serializer):
    draft = serializers.DictField()

    def validate_draft(self, value: dict[str, Any]) -> dict[str, Any]:
        error = best_match(_room_draft_validator().iter_errors(value))
        if error is not None:
            path = "/".join(str(part) for part in error.absolute_path) or "(root)"
            raise serializers.ValidationError(f"{path}: {error.message}"[:300])
        return value


class PhotoDraftConfirmSerializer(serializers.Serializer):
    # Built in the browser by core's `draftToCommands`. Its `id` becomes the new design's.
    document = serializers.DictField()
    name = serializers.CharField(max_length=200, required=False)

from rest_framework import serializers

from .models import Design, DesignVersion, Project

# A Design Document is an open JSON object here. Its shape is checked by
# `documents.validate_document`, against the JSON Schema that core generates.


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ("id", "name", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class DesignSummarySerializer(serializers.ModelSerializer):
    """A design in a list, without its document."""

    class Meta:
        model = Design
        fields = ("id", "project", "name", "draft_revision", "created_at", "updated_at")
        read_only_fields = fields


class DesignSerializer(serializers.ModelSerializer):
    draft_document = serializers.DictField(read_only=True)

    class Meta:
        model = Design
        fields = (
            "id",
            "project",
            "name",
            "draft_document",
            "draft_revision",
            "schema_version",
            "created_at",
            "updated_at",
        )
        read_only_fields = tuple(field for field in fields if field != "name")


class DesignCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    # Optional. Its `id` is replaced by the id of the new design.
    document = serializers.DictField(required=False)


class DraftSaveSerializer(serializers.Serializer):
    document = serializers.DictField()
    base_revision = serializers.IntegerField(min_value=1)


class DraftSavedSerializer(serializers.Serializer):
    draft_revision = serializers.IntegerField()
    updated_at = serializers.DateTimeField()


class DraftConflictSerializer(DraftSavedSerializer):
    detail = serializers.CharField()


class DesignVersionSummarySerializer(serializers.ModelSerializer):
    """A snapshot in a list, without its document."""

    class Meta:
        model = DesignVersion
        fields = ("id", "number", "label", "schema_version", "created_at")
        read_only_fields = fields


class DesignVersionSerializer(serializers.ModelSerializer):
    document = serializers.DictField(read_only=True)

    class Meta:
        model = DesignVersion
        fields = ("id", "number", "label", "document", "schema_version", "created_at")
        read_only_fields = fields


class DesignVersionCreateSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=200, allow_blank=True, default="")


class DocumentIssueSerializer(serializers.Serializer):
    # Where the problem is, as core writes paths: `room.walls[0].end`.
    path = serializers.CharField(allow_blank=True)
    message = serializers.CharField()


class InvalidDocumentSerializer(serializers.Serializer):
    """The body of a 422."""

    detail = serializers.CharField()
    errors = DocumentIssueSerializer(many=True)

from rest_framework import serializers

MAX_KEY_LENGTH = 500
MAX_MODEL_LENGTH = 100


class ModelsSerializer(serializers.Serializer):
    router = serializers.CharField()
    default = serializers.CharField()
    escalation = serializers.CharField()


class LLMSettingsSerializer(serializers.Serializer):
    """What staff see. The key itself is never in it, only its last four characters."""

    vendor = serializers.CharField()
    configured = serializers.BooleanField()
    key_source = serializers.ChoiceField(choices=["settings", "environment", "none"])
    api_key_last4 = serializers.CharField(allow_blank=True)
    models = ModelsSerializer()
    default_models = ModelsSerializer()
    updated_at = serializers.DateTimeField(allow_null=True)


class LLMSettingsUpdateSerializer(serializers.Serializer):
    """An empty `api_key` removes the stored key; an empty model name restores its default."""

    api_key = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_KEY_LENGTH, write_only=True
    )
    router_model = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_MODEL_LENGTH
    )
    default_model = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_MODEL_LENGTH
    )
    escalation_model = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_MODEL_LENGTH
    )

    def validate_api_key(self, value: str) -> str:
        if any(character.isspace() for character in value):
            raise serializers.ValidationError("An API key has no spaces.")
        return value

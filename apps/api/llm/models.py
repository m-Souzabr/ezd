from django.conf import settings as django_settings
from django.db import models


class LLMSettings(models.Model):
    """The assistant's settings for the whole site, entered by staff. One row, id 1.

    The API key is stored encrypted (see `llm.secrets`) and is never sent back: the API
    answers with its last four characters only. An empty model name means the default
    from the Django settings.
    """

    encrypted_api_key = models.TextField(blank=True)
    api_key_last4 = models.CharField(max_length=4, blank=True)
    router_model = models.CharField(max_length=100, blank=True)
    default_model = models.CharField(max_length=100, blank=True)
    escalation_model = models.CharField(max_length=100, blank=True)
    updated_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "LLM settings"
        verbose_name_plural = "LLM settings"

    def __str__(self) -> str:
        return "LLM settings"

    @classmethod
    def load(cls) -> "LLMSettings":
        row, _ = cls.objects.get_or_create(pk=1)
        return row

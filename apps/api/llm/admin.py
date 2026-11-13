from django.contrib import admin

from .models import LLMSettings


@admin.register(LLMSettings)
class LLMSettingsAdmin(admin.ModelAdmin):
    # The key is entered on the AI settings page, never shown: not even encrypted here.
    fields = ("api_key_last4", "router_model", "default_model", "escalation_model", "updated_by")
    readonly_fields = ("api_key_last4", "updated_by")

from django.urls import path

from . import views

urlpatterns = [
    path("llm/settings/", views.LLMSettingsView.as_view(), name="llm-settings"),
]

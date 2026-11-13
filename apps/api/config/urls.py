from django.contrib import admin
from django.urls import include, path

from . import errors, openapi  # noqa: F401  (register the error hook and the OpenAPI scheme)
from .views import health, ready

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/ready/", ready, name="ready"),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("projects.urls")),
    path("api/", include("quotes.urls")),
    path("api/", include("chat.urls")),
    path("api/", include("llm.urls")),
    path("api/", include("photos.urls")),
]

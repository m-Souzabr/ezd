from django.contrib import admin
from django.urls import include, path

from . import openapi  # noqa: F401  (registers the OpenAPI authentication scheme)
from .views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("projects.urls")),
]

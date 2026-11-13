from typing import Any

from django.contrib import admin
from django.http import HttpRequest

from .models import Design, DesignVersion, Project

# The admin sees every account's rows, archived projects included, and changes none of them:
# a document is only written through `projects.documents.validate_document`, which the admin
# forms do not run.


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(Project)
class ProjectAdmin(ReadOnlyAdmin):
    list_display = ("name", "owner", "created_at", "updated_at", "archived_at")
    list_filter = ("archived_at",)
    list_select_related = ("owner",)
    search_fields = ("name", "owner__email", "owner__name")
    date_hierarchy = "created_at"


@admin.register(Design)
class DesignAdmin(ReadOnlyAdmin):
    list_display = ("name", "project", "owner", "draft_revision", "updated_at")
    list_select_related = ("project__owner",)
    search_fields = ("name", "project__name", "project__owner__email")
    date_hierarchy = "created_at"

    @admin.display(description="Owner", ordering="project__owner__email")
    def owner(self, obj: Design) -> str:
        return str(obj.project.owner)


@admin.register(DesignVersion)
class DesignVersionAdmin(ReadOnlyAdmin):
    list_display = ("design", "number", "label", "created_by", "created_at")
    list_select_related = ("design", "created_by")
    search_fields = ("design__name", "label", "created_by__email")

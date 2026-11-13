from typing import Any

from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.db.models import QuerySet
from django.http import HttpRequest

from controlpanel.guards import GuardError, check_change, check_delete, check_delete_many

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ("email",)
    list_display = ("email", "name", "is_staff")
    search_fields = ("email", "name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("name",)}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)

    # The same guards as the Control Panel API: the last active superuser stays, and nobody
    # locks themselves out.

    def save_model(self, request: HttpRequest, obj: User, form: Any, change: bool) -> None:
        if change:
            current = User.objects.get(pk=obj.pk)
            try:
                check_change(
                    request.user,
                    current,
                    is_active=obj.is_active,
                    is_superuser=obj.is_superuser,
                    is_staff=obj.is_staff,
                )
            except GuardError as error:
                messages.error(request, str(error))
                return
        super().save_model(request, obj, form, change)

    def has_delete_permission(self, request: HttpRequest, obj: User | None = None) -> bool:
        if obj is not None:
            try:
                check_delete(request.user, obj)
            except GuardError:
                return False
        return super().has_delete_permission(request, obj)

    def delete_queryset(self, request: HttpRequest, queryset: QuerySet[User]) -> None:
        try:
            check_delete_many(request.user, list(queryset))
        except GuardError as error:
            messages.error(request, str(error))
            return
        super().delete_queryset(request, queryset)

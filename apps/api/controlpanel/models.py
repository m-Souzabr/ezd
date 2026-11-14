from typing import Any

from django.conf import settings
from django.db import models

from .codes import PERMISSION_CHOICES


class ControlPanelPermission(models.Model):
    """Holds the Control Panel's permission codes. It has no table: only its permissions matter."""

    class Meta:
        managed = False
        default_permissions = ()
        permissions = PERMISSION_CHOICES

    def __str__(self) -> str:
        return "Control Panel permission"


class AuditEntry(models.Model):
    """One change made through the Control Panel. Written by `controlpanel.audit.record`."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Kept next to the actor so the entry still says who it was after the account is deleted.
    actor_email = models.CharField(max_length=254, blank=True)
    action = models.CharField(max_length=100)
    object_type = models.CharField(max_length=100)
    object_id = models.CharField(max_length=100, blank=True)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        verbose_name_plural = "audit entries"
        indexes = [models.Index(fields=["created_at"], name="audit_created_at")]

    def __str__(self) -> str:
        return f"{self.action} {self.object_type} {self.object_id}"


class ConfigVersion(models.Model):
    """One version of the app configuration the Control Panel edits.

    That is three sections that are published together: the app settings, the rules and the
    quote defaults. Each is edited with its own permission.

    At most one row is the draft and at most one is published. Publishing turns the draft
    into the new published row, with the next `number`, and marks the previous published
    row `superseded`; a published row is never changed again.
    """

    class Status(models.TextChoices):
        DRAFT = "draft"
        PUBLISHED = "published"
        SUPERSEDED = "superseded"

    # Null while a draft: the number is given when it is published.
    number = models.PositiveIntegerField(null=True, blank=True, unique=True)
    status = models.CharField(max_length=10, choices=Status.choices)
    app_config = models.JSONField(default=dict)
    # The design rules' thresholds, severities and snap options; empty means the defaults.
    rules_config = models.JSONField(default=dict)
    # The defaults of a new quote and its PDF branding; empty means the defaults.
    quote_defaults = models.JSONField(default=dict)
    # Counts the saves of a draft, so a stale save can be refused.
    revision = models.PositiveIntegerField(default=1)
    note = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Who saved the draft last, so a stale save can say who got there first.
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-id",)
        constraints = [
            models.UniqueConstraint(
                fields=["status"],
                condition=models.Q(status="draft"),
                name="one_config_draft",
            ),
            models.UniqueConstraint(
                fields=["status"],
                condition=models.Q(status="published"),
                name="one_config_published",
            ),
        ]

    def __str__(self) -> str:
        return f"Config {self.number or 'draft'} ({self.status})"


class CatalogVersion(models.Model):
    """One version of the cabinet catalog the Control Panel edits.

    A published row is never changed or deleted: a stored quote names the `version` it was
    priced with, and that version must still be there to check it against. At most one row
    is the draft. The current catalog is the published row with the greatest `number`;
    rolling back publishes a copy of an old one as a new row.
    """

    class Status(models.TextChoices):
        DRAFT = "draft"
        PUBLISHED = "published"

    # Null while a draft: both are given when it is published.
    number = models.PositiveIntegerField(null=True, blank=True, unique=True)
    # What `catalog.version` says, and what a quote's `catalog_version` refers to.
    version = models.CharField(max_length=50, null=True, blank=True, unique=True)
    status = models.CharField(max_length=10, choices=Status.choices)
    catalog = models.JSONField(default=dict)
    # Counts the saves of a draft, so a stale save can be refused.
    revision = models.PositiveIntegerField(default=1)
    note = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Who saved the draft last, so a stale save can say who got there first.
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-id",)
        constraints = [
            models.UniqueConstraint(
                fields=["status"],
                condition=models.Q(status="draft"),
                name="one_catalog_draft",
            ),
        ]

    def __str__(self) -> str:
        return f"Catalog {self.version or 'draft'} ({self.status})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if self.pk and not self._state.adding:
            stored = CatalogVersion.objects.filter(pk=self.pk).values_list("status", flat=True)
            if stored.first() == self.Status.PUBLISHED:
                raise ValueError("A published catalog version never changes.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        if self.status == self.Status.PUBLISHED:
            raise ValueError("A published catalog version is never deleted.")
        return super().delete(*args, **kwargs)

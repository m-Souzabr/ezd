import uuid
from typing import TYPE_CHECKING

from django.conf import settings
from django.db import models

if TYPE_CHECKING:
    from accounts.models import User

# Every model here is reached through `for_user`, which is what keeps one account's rows
# out of another's requests. An archived project hides its designs and versions as well.


class ProjectQuerySet(models.QuerySet["Project"]):
    def for_user(self, user: "User") -> "ProjectQuerySet":
        return self.filter(owner=user, archived_at__isnull=True)


class DesignQuerySet(models.QuerySet["Design"]):
    def for_user(self, user: "User") -> "DesignQuerySet":
        return self.filter(project__owner=user, project__archived_at__isnull=True)


class DesignVersionQuerySet(models.QuerySet["DesignVersion"]):
    def for_user(self, user: "User") -> "DesignVersionQuerySet":
        return self.filter(design__project__owner=user, design__project__archived_at__isnull=True)


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="projects"
    )
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Set when the user deletes the project. The row and its designs are kept.
    archived_at = models.DateTimeField(null=True, blank=True)

    objects = ProjectQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "id")
        indexes = (models.Index(fields=["owner", "archived_at"]),)

    def __str__(self) -> str:
        return self.name


class Design(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # The foreign key is indexed, which is the `Design(project)` index.
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="designs")
    name = models.CharField(max_length=200)
    # The working copy that autosave overwrites. Its `id` is always this design's id.
    draft_document = models.JSONField()
    # Goes up by one on every write of the draft; autosave compares against it.
    draft_revision = models.PositiveIntegerField(default=1)
    schema_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = DesignQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "id")

    def __str__(self) -> str:
        return self.name


class DesignVersion(models.Model):
    """An immutable snapshot of a design's draft. Nothing updates a row after its insert."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    design = models.ForeignKey(Design, on_delete=models.CASCADE, related_name="versions")
    # 1, 2, 3 and so on within one design.
    number = models.PositiveIntegerField()
    label = models.CharField(max_length=200, blank=True)
    document = models.JSONField()
    schema_version = models.PositiveIntegerField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="design_versions"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = DesignVersionQuerySet.as_manager()

    class Meta:
        ordering = ("-number",)
        constraints = (
            models.UniqueConstraint(fields=["design", "number"], name="unique_design_version"),
        )

    def __str__(self) -> str:
        return f"{self.design} v{self.number}"

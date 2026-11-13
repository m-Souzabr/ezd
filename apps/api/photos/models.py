import uuid
from typing import TYPE_CHECKING, Any

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

from projects.models import Design, Project

if TYPE_CHECKING:
    from accounts.models import User


def photo_path(instance: "Photo", filename: str) -> str:
    """A name that says nothing about the owner or the uploaded file's name."""
    return f"photos/{instance.id.hex}.jpg"


class PhotoQuerySet(models.QuerySet["Photo"]):
    def for_user(self, user: "User") -> "PhotoQuerySet":
        return self.filter(owner=user, project__archived_at__isnull=True)


class Photo(models.Model):
    """A kitchen photo, re-encoded as a JPEG with no metadata. Served only to its owner."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="photos")
    file = models.FileField(upload_to=photo_path)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    bytes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    objects = PhotoQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "id")

    def __str__(self) -> str:
        return f"Photo {self.id}"


@receiver(post_delete, sender=Photo)
def _delete_file(sender: Any, instance: Photo, **kwargs: Any) -> None:
    """Removes the stored file with the row, also when a cascade deletes the row."""
    if instance.file:
        instance.file.delete(save=False)


class PhotoDraftQuerySet(models.QuerySet["PhotoDraft"]):
    def for_user(self, user: "User") -> "PhotoDraftQuerySet":
        return self.filter(photo__owner=user, photo__project__archived_at__isnull=True)


class PhotoDraft(models.Model):
    """One analysis of a photo and the user's corrections to it.

    `model_output` is the model's answer as it came; `draft` is core's normalized draft
    (`RoomDraft`), which the user edits. Neither touches a design until the user confirms,
    which creates the design and its version 1 and links them here.
    """

    class Status(models.TextChoices):
        ANALYZING = "analyzing"
        READY = "ready"
        FAILED = "failed"
        CONFIRMED = "confirmed"
        DISCARDED = "discarded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    photo = models.ForeignKey(Photo, on_delete=models.CASCADE, related_name="drafts")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ANALYZING)
    model_output = models.JSONField(null=True, blank=True)
    draft = models.JSONField(null=True, blank=True)
    # Why the analysis failed, worded for the user.
    error = models.TextField(blank=True)
    design = models.ForeignKey(
        Design, null=True, blank=True, on_delete=models.SET_NULL, related_name="photo_drafts"
    )
    model = models.CharField(max_length=100, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = PhotoDraftQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "id")

    def __str__(self) -> str:
        return f"Photo draft {self.id}"

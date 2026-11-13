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

    def __str__(self) -> str:
        return f"{self.action} {self.object_type} {self.object_id}"

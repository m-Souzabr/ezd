import uuid
from typing import TYPE_CHECKING

from django.conf import settings as django_settings
from django.db import models

from projects.models import DesignVersion, Project

if TYPE_CHECKING:
    from accounts.models import User


class QuoteQuerySet(models.QuerySet["Quote"]):
    def for_user(self, user: "User") -> "QuoteQuerySet":
        return self.filter(project__owner=user, project__archived_at__isnull=True)


class Quote(models.Model):
    """A priced bill of materials, as the browser computed it for one design version.

    Nothing updates a row after its insert: to change a quote, another one is created.
    The lines, totals and drawings are everything the PDF is rendered from.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # The project of the design version, kept here for the number and for scoping.
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="quotes")
    design_version = models.ForeignKey(
        DesignVersion, on_delete=models.CASCADE, related_name="quotes"
    )
    # 1, 2, 3 and so on within one project.
    number = models.PositiveIntegerField()
    customer_name = models.CharField(max_length=200)
    customer_email = models.EmailField(blank=True)
    customer_address = models.TextField(blank=True, max_length=1000)
    notes = models.TextField(blank=True, max_length=5000)
    catalog_version = models.CharField(max_length=50)
    settings = models.JSONField()
    lines = models.JSONField()
    totals = models.JSONField()
    drawings = models.JSONField()
    created_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quotes"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = QuoteQuerySet.as_manager()

    class Meta:
        ordering = ("-number",)
        constraints = (
            models.UniqueConstraint(fields=["project", "number"], name="unique_project_quote"),
        )

    def __str__(self) -> str:
        return f"Quote {self.number}"

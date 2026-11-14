from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from controlpanel import audit
from controlpanel.models import AuditEntry


class Command(BaseCommand):
    help = (
        "Deletes audit entries older than a number of days "
        "(default: AUDIT_RETENTION_DAYS; 0 keeps them all)."
    )

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--days", type=int, default=None, help="Keep this many days.")
        parser.add_argument("--dry-run", action="store_true", help="Only count what would go.")

    def handle(self, *args: Any, **options: Any) -> None:
        days = settings.AUDIT_RETENTION_DAYS if options["days"] is None else options["days"]
        if days < 0:
            raise CommandError("--days cannot be negative.")
        if days == 0:
            self.stdout.write("Retention is 0: every audit entry is kept.")
            return
        old = AuditEntry.objects.filter(created_at__lt=timezone.now() - timedelta(days=days))
        count = old.count()
        if options["dry_run"]:
            self.stdout.write(f"{count} audit entries are older than {days} days.")
            return
        old.delete()
        # The log says that it was pruned, and how much, without the entries' content.
        audit.record(None, "audit.prune", "audit", "", after={"days": days, "deleted": count})
        self.stdout.write(f"Deleted {count} audit entries older than {days} days.")

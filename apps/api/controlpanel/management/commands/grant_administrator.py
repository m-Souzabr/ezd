from typing import Any

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from controlpanel import audit
from controlpanel.codes import ADMINISTRATOR


class Command(BaseCommand):
    help = "Makes an existing account an active staff member in the Administrator role."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("email")
        parser.add_argument(
            "--superuser", action="store_true", help="Also make the account a superuser."
        )

    def handle(self, *args: Any, **options: Any) -> None:
        User = get_user_model()
        try:
            user = User.objects.get(email__iexact=options["email"])
        except User.DoesNotExist as error:
            raise CommandError(f"There is no account for {options['email']}.") from error
        try:
            role = Group.objects.get(name=ADMINISTRATOR)
        except Group.DoesNotExist as error:
            raise CommandError(
                "The Administrator role is missing: run `manage.py migrate`."
            ) from error
        user.is_active = True
        user.is_staff = True
        if options["superuser"]:
            user.is_superuser = True
        user.save()
        user.groups.add(role)
        audit.record(
            None,
            "user.grant_administrator",
            "user",
            user.pk,
            after={"email": user.email, "is_superuser": user.is_superuser},
        )
        self.stdout.write(f"{user.email} is now staff in the {ADMINISTRATOR} role.")

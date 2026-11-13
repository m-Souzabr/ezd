from django.db import migrations

# Copies of `controlpanel.codes`: a migration must not change when that module does.
CODES = {
    "config.catalog.edit": "Edit the catalog",
    "config.catalog.publish": "Publish the catalog",
    "config.rules.edit": "Edit the rules",
    "config.app.edit": "Edit the app settings",
    "config.quote.edit": "Edit the quote defaults",
    "llm.settings.edit": "Edit the AI settings",
    "users.view": "View users",
    "users.manage": "Manage users",
    "users.roles.assign": "Assign roles",
    "audit.view": "View the audit log",
}
ROLES = {
    "Administrator": list(CODES),
    "Catalog editor": ["config.catalog.edit", "config.catalog.publish"],
    "Support": ["users.view", "users.manage"],
}


def seed(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    Permission = apps.get_model("auth", "Permission")
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("accounts", "User")

    content_type, _ = ContentType.objects.get_or_create(
        app_label="controlpanel", model="controlpanelpermission"
    )
    permissions = {}
    for codename, name in CODES.items():
        permissions[codename], _ = Permission.objects.get_or_create(
            content_type=content_type, codename=codename, defaults={"name": name}
        )
    groups = {}
    for role, codes in ROLES.items():
        groups[role], _ = Group.objects.get_or_create(name=role)
        groups[role].permissions.set([permissions[code] for code in codes])

    # Staff could use the AI settings page before roles existed; they keep every power.
    for user in User.objects.filter(is_staff=True):
        user.groups.add(groups["Administrator"])


def unseed(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name__in=list(ROLES)).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("controlpanel", "0001_initial"),
        ("accounts", "0002_user_name"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]

    operations = [migrations.RunPython(seed, unseed)]

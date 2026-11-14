import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def grant_roles_manage(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    Permission = apps.get_model("auth", "Permission")
    Group = apps.get_model("auth", "Group")
    content_type, _ = ContentType.objects.get_or_create(
        app_label="controlpanel", model="controlpanelpermission"
    )
    permission, _ = Permission.objects.get_or_create(
        content_type=content_type,
        codename="users.roles.manage",
        defaults={"name": "Manage roles"},
    )
    for group in Group.objects.filter(name="Administrator"):
        group.permissions.add(permission)


class Migration(migrations.Migration):
    dependencies = [
        ("controlpanel", "0006_rules_and_quote_defaults"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("contenttypes", "0002_remove_content_type_name"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="configversion",
            name="updated_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="catalogversion",
            name="updated_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name="auditentry",
            index=models.Index(fields=["created_at"], name="audit_created_at"),
        ),
        migrations.RunPython(grant_roles_manage, migrations.RunPython.noop),
    ]

import json
from pathlib import Path

from django.conf import settings
from django.db import migrations


def publish_seed(apps, schema_editor):
    """The compiled-in seed catalog is the first published version, so quotes can name it."""
    CatalogVersion = apps.get_model("controlpanel", "CatalogVersion")
    if CatalogVersion.objects.filter(status="published").exists():
        return
    catalog = json.loads(Path(settings.CATALOG_SEED_PATH).read_text(encoding="utf-8"))
    CatalogVersion.objects.create(
        number=1,
        version=catalog["version"],
        status="published",
        catalog=catalog,
        note="The built-in catalog",
    )


class Migration(migrations.Migration):
    dependencies = [("controlpanel", "0004_catalog_version")]
    # Additive: it leaves a row in place on reverse, like a published version should be.
    operations = [migrations.RunPython(publish_seed, migrations.RunPython.noop)]

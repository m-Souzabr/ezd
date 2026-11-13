"""The cabinet catalog: what is published, what is being edited, and how it is checked.

The shape of a catalog and its rules live in core. The API runs `ezd-core validate-catalog`
for them, and `ezd-core llm-tools` for the assistant's tools, so the server never writes a
second copy of either.
"""

import json
import subprocess
from functools import cache
from pathlib import Path
from typing import Any

from django.conf import settings
from django.db.models import Max
from rest_framework import status
from rest_framework.exceptions import APIException

from .models import CatalogVersion

Issue = dict[str, str]
Catalog = dict[str, Any]
CLI_TIMEOUT_SECONDS = 10
Status = CatalogVersion.Status


class InvalidCatalog(APIException):
    """The catalog breaks a rule. `errors` lists each one with its path."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "The catalog is not valid."
    default_code = "invalid_catalog"

    def __init__(self, errors: list[Issue]) -> None:
        super().__init__()
        self.errors = errors


class CatalogCheckUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The catalog cannot be checked right now."
    default_code = "validation_unavailable"


class StaleCatalogDraft(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The draft was changed by someone else. Reload it and try again."
    default_code = "stale_draft"


class CatalogConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "catalog_conflict"


def core(command: str, payload: Any) -> dict[str, Any]:
    """Runs one `ezd-core` command on a JSON payload. Raises `CatalogCheckUnavailable`."""
    try:
        result = subprocess.run(
            [*settings.EZD_CORE_CLI, command],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT_SECONDS,
            check=False,
        )
        output = json.loads(result.stdout)
        # A nonzero exit is how core says "problems": it is still an answer.
        if not isinstance(output, dict) or output["ok"] != (result.returncode == 0):
            raise ValueError("unexpected ezd-core output")
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise CatalogCheckUnavailable() from error
    return output


def _issues(items: list[dict[str, Any]]) -> list[Issue]:
    return [{"path": str(item["path"]), "message": str(item["message"])} for item in items]


def check_structure(catalog: Any) -> Catalog:
    """The catalog as core read it, or raises `InvalidCatalog` if it is not a catalog at all.

    A draft only has to get this far to be saved: the rules are for publishing.
    """
    output = core("validate-catalog", catalog)
    if output["errors"]:
        raise InvalidCatalog(_issues(output["errors"]))
    return output["catalog"]


def problems(catalog: Any) -> list[Issue]:
    """Every problem with the catalog, the structural ones and the rules'. Empty if valid."""
    output = core("validate-catalog", catalog)
    return _issues(output["errors"]) + _issues(output["problems"])


def validate_for_publish(catalog: Any) -> Catalog:
    """The catalog, if it satisfies every rule, else raises `InvalidCatalog` with each one."""
    found = problems(catalog)
    if found:
        raise InvalidCatalog(found)
    return catalog


@cache
def seed_catalog() -> Catalog:
    return json.loads(Path(settings.CATALOG_SEED_PATH).read_text(encoding="utf-8"))


def published() -> CatalogVersion | None:
    """The current catalog: the published row with the greatest number."""
    return CatalogVersion.objects.filter(status=Status.PUBLISHED).order_by("-number").first()


def draft() -> CatalogVersion | None:
    return CatalogVersion.objects.filter(status=Status.DRAFT).first()


def published_catalog() -> Catalog:
    """What the app uses. Without a row it is the seed, which is what the first row holds."""
    row = published()
    return row.catalog if row else seed_catalog()


def version_row(version: str) -> CatalogVersion | None:
    return CatalogVersion.objects.filter(status=Status.PUBLISHED, version=version).first()


def catalog_for_version(version: str) -> Catalog | None:
    """A published catalog by its version string, or None. The seed answers for itself."""
    row = version_row(version)
    if row:
        return row.catalog
    seed = seed_catalog()
    return seed if seed["version"] == version else None


def next_number() -> int:
    return (CatalogVersion.objects.aggregate(m=Max("number"))["m"] or 0) + 1


def version_name(number: int) -> str:
    """`catalog-2`. Number 1 is the seed, which keeps the name it was written with."""
    return seed_catalog()["version"] if number == 1 else f"catalog-{number}"


def retire_ids(catalog: Catalog) -> set[str]:
    return {entry["id"] for entry in catalog["entries"] if entry.get("retired")}


@cache
def _tools_for(version: str, catalog_json: str) -> tuple[list[dict[str, Any]], str]:
    output = core("llm-tools", json.loads(catalog_json))
    return output["tools"]["tools"], output["index"]


def assistant_tools(catalog: Catalog | None = None) -> tuple[list[dict[str, Any]], str]:
    """The assistant's tool definitions and catalog index for a catalog, cached by version.

    A published version never changes, so its tools are made once per process.
    """
    catalog = catalog if catalog is not None else published_catalog()
    return _tools_for(catalog["version"], json.dumps(catalog, sort_keys=True))

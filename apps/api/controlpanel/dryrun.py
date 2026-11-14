"""The dry run before a publish: what the new configuration would change for what exists.

Designs are checked with `ezd-core compare-designs`, once under the published configuration
and once under the proposed one, on the most recently changed designs. The sample is bounded,
so the answer is the same few seconds on any database.
"""

import json
import subprocess
from typing import Any

from django.conf import settings

from projects.models import Design
from quotes.models import Quote

from .catalogs import Catalog, CatalogCheckUnavailable, InvalidCatalog, retire_ids

SAMPLE_DESIGNS = 50
SAMPLE_QUOTES = 100
SAMPLE_IDS = 5
CLI_TIMEOUT_SECONDS = 30
Violation = dict[str, Any]


def _key(violation: Violation) -> tuple[str, str, tuple[str, ...]]:
    """What a violation is: its rule, severity and items. Not its wording, which can name the
    catalog's other entries and so changes whenever one is added."""
    return (violation["ruleId"], violation["severity"], tuple(violation["itemIds"]))


def _compare(documents: list[dict[str, Any]], before: dict[str, Any], after: dict[str, Any]):
    payload = {"designs": documents, "before": before, "after": after}
    try:
        result = subprocess.run(
            [*settings.EZD_CORE_CLI, "compare-designs"],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT_SECONDS,
            check=False,
        )
        output = json.loads(result.stdout)
        if not isinstance(output, dict) or output["ok"] != (result.returncode == 0):
            raise ValueError("unexpected ezd-core output")
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise CatalogCheckUnavailable() from error
    return output


def designs_report(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """How many sampled designs have other violations under `after` than under `before`.

    Each side is `{ catalog?, rules? }`, as `compare-designs` reads it.
    """
    rows = list(Design.objects.order_by("-updated_at")[:SAMPLE_DESIGNS])
    total = Design.objects.count()
    report: dict[str, Any] = {"total": total, "sampled": len(rows), "changed": 0, "samples": []}
    if not rows:
        return report
    output = _compare(
        [{"id": str(row.pk), "document": row.draft_document} for row in rows], before, after
    )
    if not output["ok"]:
        raise InvalidCatalog(
            [{"path": str(e["path"]), "message": str(e["message"])} for e in output["errors"]]
        )
    names = {str(row.pk): row.name for row in rows}
    for result in output["results"]:
        if result["error"]:
            continue
        old = {_key(v): v["message"] for v in result["before"]}
        new = {_key(v): v["message"] for v in result["after"]}
        if old.keys() == new.keys():
            continue
        report["changed"] += 1
        if len(report["samples"]) < SAMPLE_IDS:
            report["samples"].append(
                {
                    "id": result["id"],
                    "name": names.get(result["id"], ""),
                    "introduced": sorted(new[key] for key in new.keys() - old.keys())[:3],
                    "cleared": sorted(old[key] for key in old.keys() - new.keys())[:3],
                }
            )
    return report


def quotes_report(catalog: Catalog | None) -> dict[str, Any]:
    """Sampled quotes with a line the proposed catalog no longer offers.

    A stored quote is immutable and is checked against the catalog version it names, so it is
    never changed. This says which ones could not be made again as they are.
    """
    total = Quote.objects.count()
    report: dict[str, Any] = {"total": total, "sampled": 0, "changed": 0, "samples": []}
    if catalog is None:
        return report
    offered = {entry["id"] for entry in catalog["entries"]} - retire_ids(catalog)
    rows = Quote.objects.order_by("-created_at")[:SAMPLE_QUOTES]
    for quote in rows:
        report["sampled"] += 1
        missing = sorted(
            {
                line["catalogId"]
                for line in quote.lines
                if line["catalogId"] != "countertop" and line["catalogId"] not in offered
            }
        )
        if not missing:
            continue
        report["changed"] += 1
        if len(report["samples"]) < SAMPLE_IDS:
            report["samples"].append(
                {"id": str(quote.pk), "name": f"Quote {quote.number}", "missing": missing[:3]}
            )
    return report

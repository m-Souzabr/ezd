"""Server time of autosave for a 200-item design, against the target in #12: under 300 ms
at the 95th percentile. Timed through the test client, so it is the time Django spends,
without the network.
"""

import json
import time
from pathlib import Path

from django.conf import settings
from rest_framework.test import APIClient

from projects.models import Design

AUTOSAVE_P95_BUDGET_MS = 300
FIXTURE = Path(settings.REPO_DIR) / "packages/core/src/document/fixtures/kitchen-200.json"
SAVES = 40


def test_autosave_of_a_200_item_design(client: APIClient, design: Design) -> None:
    document = {**json.loads(FIXTURE.read_text("utf-8")), "id": str(design.id)}
    revision = design.draft_revision
    timings = []
    for i in range(SAVES):
        document["name"] = f"Kitchen {i}"
        started = time.perf_counter()
        response = client.put(
            f"/api/designs/{design.id}/draft/",
            {"document": document, "base_revision": revision},
        )
        timings.append((time.perf_counter() - started) * 1000)
        assert response.status_code == 200, response.json()
        revision = response.json()["draft_revision"]
    timings.sort()
    p95 = timings[int(len(timings) * 0.95) - 1]
    print(f"autosave, 200 items: median {timings[len(timings) // 2]:.0f} ms, p95 {p95:.0f} ms")
    assert p95 < AUTOSAVE_P95_BUDGET_MS

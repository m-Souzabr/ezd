import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import DatabaseError
from django.utils.module_loading import import_string

from llm import config
from llm.client import LLMClient
from llm.fake import FakeClient, photo_response_from_json, photo_response_to_json
from photos.evals import PhotoResult, load_set, markdown, report, run_photo


class Command(BaseCommand):
    help = (
        "Runs the photo test set (evals/photos/) through the analyze code path and writes a "
        "JSON and a Markdown report. --client fake replays evals/photos/recordings/fake; "
        "--client live calls the vendor with the configured key."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--client", choices=["fake", "live"], default="fake")
        parser.add_argument("--vendor", help="A key of LLM_CLIENTS, for --client live.")
        parser.add_argument("--model", help="The vision model. Defaults to the settings.")
        parser.add_argument("--escalation-model")
        parser.add_argument("--photo", action="append", help="Run only these photos.")
        parser.add_argument("--out", help="Report directory. Defaults to evals/reports/<run>.")
        parser.add_argument(
            "--record",
            action="store_true",
            help="With --client live: save each photo's answers to "
            "evals/photos/recordings/<vendor>/.",
        )
        parser.add_argument(
            "--min-schema-valid",
            type=float,
            default=0.0,
            help="Exit with an error below this schema-valid rate (0 to 1).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        directory = Path(settings.EVALS_DIR) / "photos"
        photos = load_set(directory, options["photo"])
        if not photos:
            raise CommandError("No photo with a ground truth file matches.")

        live = options["client"] == "live"
        vendor = options["vendor"] or (settings.LLM_VENDOR if live else "fake")
        # From the settings and the flags only, so a run needs no database.
        model = options["model"] or settings.LLM_MODEL_VISION or settings.LLM_DEFAULT_MODEL
        escalation = options["escalation_model"] or settings.LLM_ESCALATION_MODEL
        live_client = self._live_client(vendor) if live else None

        results: list[PhotoResult] = []
        for name, image, truth in photos:
            client: LLMClient = live_client or self._fake_client(directory, name)
            result = run_photo(name, image, truth, client, model, escalation)
            results.append(result)
            if options["record"] and live:
                self._record(directory / "recordings" / vendor / f"{name}.json", result)
            mark = "valid" if result.schema_valid else "INVALID"
            self.stdout.write(
                f"{mark}  {name}  (shape {result.shape}, expected {result.expected_shape}, "
                f"{result.attempts} attempt(s))"
            )

        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        data = report(
            results,
            {
                "client": options["client"],
                "vendor": vendor,
                "models": {"vision": model, "escalation": escalation},
                "run_at": stamp,
            },
        )
        out = Path(
            options["out"]
            or Path(settings.EVALS_DIR) / "reports" / f"{stamp}-photos-{options['client']}"
        )
        out.mkdir(parents=True, exist_ok=True)
        (out / "report.json").write_text(json.dumps(data, indent=2) + "\n", "utf-8")
        (out / "report.md").write_text(markdown(data), "utf-8")
        self.stdout.write(
            f"schema-valid {data['schema_valid_rate']:.1%}, shape accuracy "
            f"{data['shape_accuracy']:.1%}; report in {out}"
        )
        if data["schema_valid_rate"] < options["min_schema_valid"]:
            raise CommandError(
                f"Schema-valid rate {data['schema_valid_rate']:.1%} is below "
                f"{options['min_schema_valid']:.1%}."
            )

    def _live_client(self, vendor: str) -> LLMClient:
        if vendor not in settings.LLM_CLIENTS or vendor == "fake":
            raise CommandError(f"Unknown vendor {vendor!r} for a live run.")
        key = settings.LLM_API_KEY
        if not key:
            try:
                key, _ = config.api_key()
            except DatabaseError:
                key = ""
        if not key:
            raise CommandError("No API key: set LLM_API_KEY or enter one in AI settings.")
        client_class = import_string(settings.LLM_CLIENTS[vendor])
        return client_class(api_key=key, timeout_seconds=settings.LLM_PHOTO_TIMEOUT_SECONDS)

    def _fake_client(self, directory: Path, name: str) -> FakeClient:
        path = directory / "recordings" / "fake" / f"{name}.json"
        if not path.exists():
            raise CommandError(f"No recording for photo {name}: {path}")
        recorded = json.loads(path.read_text("utf-8"))["responses"]
        return FakeClient(photo_responses=[photo_response_from_json(r) for r in recorded])

    def _record(self, path: Path, result: PhotoResult) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        responses = [photo_response_to_json(response) for response in result.responses]
        path.write_text(json.dumps({"responses": responses}, indent=2) + "\n", "utf-8")

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import DatabaseError
from django.utils.module_loading import import_string

from chat.evals import markdown, report, run_case
from llm import config
from llm.client import LLMClient
from llm.config import Models
from llm.fake import FakeClient, response_from_json, response_to_json


class Command(BaseCommand):
    help = (
        "Runs the assistant's eval suite (evals/cases.json) through the chat code path and "
        "writes a JSON and a Markdown report. --client fake replays evals/recordings/fake; "
        "--client live calls the vendor with the configured key."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--client", choices=["fake", "live"], default="fake")
        parser.add_argument("--vendor", help="A key of LLM_CLIENTS, for --client live.")
        parser.add_argument("--router-model")
        parser.add_argument("--default-model")
        parser.add_argument("--escalation-model")
        parser.add_argument("--case", action="append", help="Run only these cases (repeatable).")
        parser.add_argument("--out", help="Report directory. Defaults to evals/reports/<run>.")
        parser.add_argument(
            "--record",
            action="store_true",
            help="With --client live: save each case's responses to evals/recordings/<vendor>/.",
        )
        parser.add_argument(
            "--min-accuracy",
            type=float,
            default=0.0,
            help="Exit with an error below this accuracy (0 to 1).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        evals = Path(settings.EVALS_DIR)
        cases = json.loads((evals / "cases.json").read_text("utf-8"))
        if options["case"]:
            cases = [case for case in cases if case["name"] in options["case"]]
            if not cases:
                raise CommandError("No case has that name.")

        live = options["client"] == "live"
        vendor = options["vendor"] or (settings.LLM_VENDOR if live else "fake")
        # From the settings and the flags only, so a run needs no database.
        models = Models(
            router=options["router_model"] or settings.LLM_ROUTER_MODEL,
            default=options["default_model"] or settings.LLM_DEFAULT_MODEL,
            escalation=options["escalation_model"] or settings.LLM_ESCALATION_MODEL,
        )
        live_client = self._live_client(vendor) if live else None

        results = []
        for case in cases:
            client: LLMClient = live_client or self._fake_client(evals, case["name"])
            result = run_case(case, client, models)
            results.append(result)
            if options["record"] and live:
                self._record(evals / "recordings" / vendor / f"{case['name']}.json", result)
            mark = "pass" if result.passed else "FAIL"
            self.stdout.write(f"{mark}  {case['name']}  ({result.outcome}, {result.attempts})")
            for failure in result.failures:
                self.stdout.write(f"      {failure}")

        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        data = report(
            results,
            {
                "client": options["client"],
                "vendor": vendor,
                "models": vars(models),
                "run_at": stamp,
            },
        )
        out = Path(options["out"] or evals / "reports" / f"{stamp}-{options['client']}")
        out.mkdir(parents=True, exist_ok=True)
        (out / "report.json").write_text(json.dumps(data, indent=2) + "\n", "utf-8")
        (out / "report.md").write_text(markdown(data), "utf-8")
        self.stdout.write(
            f"accuracy {data['accuracy']:.1%}, valid proposals after retries "
            f"{data['valid_proposal_rate_after_retries']:.1%}; report in {out}"
        )
        if data["accuracy"] < options["min_accuracy"]:
            raise CommandError(
                f"Accuracy {data['accuracy']:.1%} is below {options['min_accuracy']:.1%}."
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
        return client_class(api_key=key, timeout_seconds=settings.LLM_TIMEOUT_SECONDS)

    def _fake_client(self, evals: Path, name: str) -> FakeClient:
        path = evals / "recordings" / "fake" / f"{name}.json"
        if not path.exists():
            raise CommandError(f"No recording for case {name}: {path}")
        recorded = json.loads(path.read_text("utf-8"))["responses"]
        return FakeClient([response_from_json(response) for response in recorded])

    def _record(self, path: Path, result: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        responses = [response_to_json(response) for response in result.responses]
        path.write_text(json.dumps({"responses": responses}, indent=2) + "\n", "utf-8")

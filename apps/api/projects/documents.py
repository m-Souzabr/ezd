"""Validation of Design Documents before they are stored.

The API cannot import `@ezd/core`, so it checks a document in two steps: the JSON Schema
generated from core's Zod schemas, then `ezd-core validate-document`, which runs core's own
parser for what a schema cannot say (unique ids, wall references, zero-length walls).
"""

import json
import subprocess
from functools import cache
from typing import Any

from django.conf import settings
from jsonschema import Draft202012Validator
from rest_framework import status
from rest_framework.exceptions import APIException

Document = dict[str, Any]
Issue = dict[str, str]

# 96 in, in sixteenths of an inch. The same default as core's `createEmptyDocument`.
DEFAULT_CEILING_HEIGHT = 1536
CLI_TIMEOUT_SECONDS = 10
MAX_MESSAGE_LENGTH = 300


class InvalidDocument(APIException):
    """The document is well-formed JSON but is not a valid Design Document."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "The document is not a valid design document."
    default_code = "invalid_document"

    def __init__(self, errors: list[Issue]) -> None:
        super().__init__()
        self.errors = errors


class DocumentValidationUnavailable(APIException):
    """`ezd-core` could not be run, so the document was not checked and is not stored."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Documents cannot be validated right now."
    default_code = "validation_unavailable"


@cache
def _schema() -> dict[str, Any]:
    with open(settings.DESIGN_DOCUMENT_SCHEMA_PATH, encoding="utf-8") as file:
        return json.load(file)


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(_schema())


def current_schema_version() -> int:
    """The one version the schema file describes, which is the newest the server knows."""
    return _schema()["properties"]["schemaVersion"]["const"]


def known_schema_versions() -> frozenset[int]:
    return frozenset({current_schema_version()})


def empty_document(design_id: str, name: str) -> Document:
    """The same document as core's `createEmptyDocument`."""
    return {
        "schemaVersion": current_schema_version(),
        "id": design_id,
        "name": name,
        "room": {"ceilingHeight": DEFAULT_CEILING_HEIGHT, "walls": [], "openings": []},
        "items": [],
        "countertops": [],
        "finishes": {},
    }


def _path(parts: Any) -> str:
    """`['room', 'walls', 0, 'end']` becomes `room.walls[0].end`, as core writes paths."""
    text = ""
    for part in parts:
        if isinstance(part, int):
            text += f"[{part}]"
        else:
            text = f"{text}.{part}" if text else str(part)
    return text


def _run_core(document: Document) -> list[Issue]:
    try:
        result = subprocess.run(
            [*settings.EZD_CORE_CLI, "validate-document"],
            input=json.dumps(document),
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT_SECONDS,
            check=False,
        )
        output = json.loads(result.stdout)
        errors = output["errors"]
        if output["ok"] != (result.returncode == 0) or not isinstance(errors, list):
            raise ValueError("unexpected ezd-core output")
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise DocumentValidationUnavailable() from error
    return [{"path": str(issue["path"]), "message": str(issue["message"])} for issue in errors]


def validate_document(document: Any, design_id: str) -> Document:
    """Returns the document if it may be stored for the design, or raises `InvalidDocument`."""
    if not isinstance(document, dict):
        raise InvalidDocument([{"path": "", "message": "Expected a design document object."}])

    version = document.get("schemaVersion")
    if isinstance(version, bool) or version not in known_schema_versions():
        known = ", ".join(str(v) for v in sorted(known_schema_versions()))
        raise InvalidDocument(
            [
                {
                    "path": "schemaVersion",
                    "message": f"Unknown schema version {version!r}. This server knows: {known}.",
                }
            ]
        )

    errors = sorted(_validator().iter_errors(document), key=lambda e: list(map(str, e.path)))
    if errors:
        raise InvalidDocument(
            [
                # A message can quote the whole value it rejects, so it is cut short.
                {"path": _path(error.absolute_path), "message": error.message[:MAX_MESSAGE_LENGTH]}
                for error in errors
            ]
        )

    if document["id"] != design_id:
        raise InvalidDocument(
            [{"path": "id", "message": f'The document id must be the design id "{design_id}".'}]
        )

    issues = _run_core(document)
    if issues:
        raise InvalidDocument(issues)
    return document

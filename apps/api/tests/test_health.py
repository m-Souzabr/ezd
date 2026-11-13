from typing import Any
from unittest import mock

import pytest
from django.db import DatabaseError
from django.test import Client, RequestFactory, override_settings

from config import errors

reported: list[tuple[BaseException, dict[str, Any]]] = []


def remember(error: BaseException, context: dict[str, Any]) -> None:
    reported.append((error, context))


def explode(error: BaseException, context: dict[str, Any]) -> None:
    raise RuntimeError("the reporter is down")


def test_health_returns_ok(client: Client) -> None:
    response = client.get("/api/health/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_ready_checks_the_database(client: Client) -> None:
    assert client.get("/api/ready/").json() == {"status": "ok"}
    with mock.patch("config.views.connection.cursor", side_effect=DatabaseError("down")):
        response = client.get("/api/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "database unavailable"}


def test_errors_go_to_the_configured_reporter() -> None:
    reported.clear()
    errors.report_error(ValueError("ignored"))
    assert reported == []
    with override_settings(ERROR_REPORTER="tests.test_health.remember"):
        errors.report_error(ValueError("boom"), {"where": "test"})
        request = RequestFactory().get("/api/x/")
        try:
            raise KeyError("in a request")
        except KeyError:
            errors._on_request_exception(None, request=request)
    assert [str(error) for error, _ in reported] == ["boom", "'in a request'"]
    assert reported[1][1] == {"method": "GET", "path": "/api/x/"}


@override_settings(ERROR_REPORTER="tests.test_health.explode")
def test_a_failing_reporter_is_ignored(caplog: pytest.LogCaptureFixture) -> None:
    errors.report_error(ValueError("boom"))
    assert "The error reporter failed" in caplog.text

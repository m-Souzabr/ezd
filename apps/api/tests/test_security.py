import json
import logging

import pytest
from django.conf import settings
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from projects.models import Design, Project

from .conftest import PASSWORD, core_fixture


def _csrf_client() -> APIClient:
    return APIClient(enforce_csrf_checks=True)


def _token(api: APIClient) -> str:
    api.get("/api/auth/me/")
    return api.cookies["csrftoken"].value


def test_login_and_register_need_a_csrf_token(user: User) -> None:
    api = _csrf_client()
    credentials = {"email": user.email, "password": PASSWORD}
    new = {"email": "new@example.com", "password": PASSWORD}

    refused = api.post("/api/auth/login/", credentials)
    assert refused.status_code == 403
    assert refused.json()["detail"].startswith("CSRF check failed")
    assert api.post("/api/auth/register/", new).status_code == 403
    assert api.post("/api/auth/password-reset/", {"email": user.email}).status_code == 403
    assert not User.objects.filter(email="new@example.com").exists()

    assert (
        api.post("/api/auth/login/", credentials, HTTP_X_CSRFTOKEN=_token(api)).status_code == 200
    )


def test_unsafe_methods_need_a_csrf_token_once_signed_in(user: User, project: Project) -> None:
    api = _csrf_client()
    api.post(
        "/api/auth/login/",
        {"email": user.email, "password": PASSWORD},
        HTTP_X_CSRFTOKEN=_token(api),
    )
    url = f"/api/projects/{project.id}/"

    assert api.get(url).status_code == 200
    assert api.post("/api/projects/", {"name": "No token"}).status_code == 403
    assert api.patch(url, {"name": "No token"}).status_code == 403
    assert api.delete(url).status_code == 403
    assert api.post("/api/auth/logout/").status_code == 403
    project.refresh_from_db()
    assert (project.name, project.archived_at) == ("Lake house", None)

    # Signing in replaced the token, so it is read again.
    token = api.cookies["csrftoken"].value
    assert api.patch(url, {"name": "With token"}, HTTP_X_CSRFTOKEN=token).status_code == 200


def test_session_cookie_flags(anonymous: APIClient, user: User) -> None:
    response = anonymous.post("/api/auth/login/", {"email": user.email, "password": PASSWORD})

    cookie = response.cookies["sessionid"]
    assert cookie["httponly"]
    assert cookie["samesite"] == "Lax"
    assert settings.SESSION_COOKIE_HTTPONLY
    assert settings.SESSION_COOKIE_SAMESITE == "Lax"


def test_production_settings_are_secure_and_come_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import importlib

    for name, value in {
        "DJANGO_SECRET_KEY": "x" * 50,
        "DJANGO_ALLOWED_HOSTS": "ezd.example.com",
        "DJANGO_CSRF_TRUSTED_ORIGINS": "https://ezd.example.com",
        "DATABASE_URL": "postgres://u:p@db:5432/ezd",
        "EMAIL_URL": "smtp+tls://u:p@mail:587",
    }.items():
        monkeypatch.setenv(name, value)
    prod = importlib.import_module("config.settings.prod")
    prod = importlib.reload(prod)

    assert prod.DEBUG is False
    assert prod.SESSION_COOKIE_SECURE and prod.CSRF_COOKIE_SECURE
    assert prod.SESSION_COOKIE_HTTPONLY and prod.SESSION_COOKIE_SAMESITE == "Lax"
    assert prod.ALLOWED_HOSTS == ["ezd.example.com"]
    assert prod.CSRF_TRUSTED_ORIGINS == ["https://ezd.example.com"]
    assert prod.EMAIL_HOST == "mail"

    monkeypatch.delenv("DJANGO_SECRET_KEY")
    with pytest.raises(Exception, match="DJANGO_SECRET_KEY"):
        importlib.reload(prod)


def test_debug_is_off_unless_asked_for() -> None:
    assert settings.DEBUG is False


def test_requests_are_logged_without_bodies_or_passwords(
    anonymous: APIClient, user: User, design: Design, caplog: pytest.LogCaptureFixture
) -> None:
    from config.logging import JsonFormatter

    secret = "a-very-secret-passphrase"
    marker = "MARKER-IN-THE-DOCUMENT"
    with caplog.at_level(logging.INFO, logger="ezd.request"):
        anonymous.post(
            "/api/auth/login/?next=/x&token=abc", {"email": user.email, "password": secret}
        )
        anonymous.force_login(user)
        anonymous.put(
            f"/api/designs/{design.id}/draft/",
            {
                "document": {**core_fixture("valid", str(design.id)), "name": marker},
                "base_revision": 1,
            },
        )

    records = [record for record in caplog.records if record.name == "ezd.request"]
    lines = [JsonFormatter().format(record) for record in records]
    login, save = (json.loads(line) for line in lines)
    assert login["method"] == "POST"
    assert login["path"] == "/api/auth/login/"
    assert login["status"] == 401
    assert login["user_id"] is None
    assert login["duration_ms"] >= 0
    assert (save["status"], save["user_id"]) == (200, user.id)
    assert save["path"] == f"/api/designs/{design.id}/draft/"
    assert len(save["request_id"]) == 32
    for line in lines:
        assert secret not in line
        assert marker not in line
        assert "token=abc" not in line


def test_responses_carry_the_request_id(anonymous: APIClient) -> None:
    assert len(anonymous.get("/api/health/")["X-Request-Id"]) == 32


@override_settings(DEBUG=True)
def test_health_needs_no_session_or_database(anonymous: APIClient) -> None:
    assert anonymous.get("/api/health/").json() == {"status": "ok"}


@pytest.mark.django_db
def test_every_response_carries_the_security_headers(client: APIClient) -> None:
    response = client.get("/api/health/")
    assert response["Content-Security-Policy"].startswith("default-src 'none'")
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["X-Frame-Options"] == "DENY"
    assert response["Referrer-Policy"] == "same-origin"
    assert "camera=()" in response["Permissions-Policy"]
    admin = client.get("/admin/login/")
    assert admin["Content-Security-Policy"].startswith("default-src 'self'")


@pytest.mark.django_db
def test_model_calls_have_their_own_throttle(client: APIClient, design: Design) -> None:
    rates = {**settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "llm": "1/min"}
    with override_settings(
        REST_FRAMEWORK={**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": rates}
    ):
        # Reading the chat is not a model call.
        for _ in range(3):
            assert client.get(f"/api/designs/{design.id}/chat/").status_code == 200
        # Counted before the body is read, so an invalid request uses up the allowance too.
        assert client.post(f"/api/designs/{design.id}/chat/", {}).status_code == 400
        assert client.post(f"/api/designs/{design.id}/chat/", {}).status_code == 429

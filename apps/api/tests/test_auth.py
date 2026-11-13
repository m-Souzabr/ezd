import re

import pytest
from django.core import mail
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User

from .conftest import PASSWORD

REGISTER = {"email": "new@example.com", "password": PASSWORD, "name": "New"}


@pytest.mark.django_db
def test_register_creates_the_account_and_signs_in(anonymous: APIClient) -> None:
    response = anonymous.post("/api/auth/register/", REGISTER)

    assert response.status_code == 201
    assert response.json() == {
        "id": User.objects.get(email="new@example.com").id,
        "email": "new@example.com",
        "name": "New",
        "is_staff": False,
        "is_superuser": False,
        "permissions": [],
    }
    assert "password" not in response.content.decode()
    assert anonymous.get("/api/auth/me/").json()["email"] == "new@example.com"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({**REGISTER, "email": "not-an-email"}, "email"),
        ({**REGISTER, "password": "short"}, "password"),
        ({**REGISTER, "password": "12345678901"}, "password"),
        ({**REGISTER, "password": "password"}, "password"),
        ({"email": "new@example.com"}, "password"),
    ],
)
def test_register_rejects_bad_input(anonymous: APIClient, body: dict, field: str) -> None:
    response = anonymous.post("/api/auth/register/", body)

    assert response.status_code == 400
    assert field in response.json()
    assert not User.objects.exists()


def test_register_rejects_a_taken_email_whatever_its_case(anonymous: APIClient, user: User) -> None:
    response = anonymous.post("/api/auth/register/", {**REGISTER, "email": "ADA@example.com"})

    assert response.status_code == 400
    assert "email" in response.json()


def test_login_starts_a_session(anonymous: APIClient, user: User) -> None:
    assert anonymous.get("/api/auth/me/").status_code == 401

    response = anonymous.post(
        "/api/auth/login/", {"email": "Ada@Example.com", "password": PASSWORD}
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": user.id,
        "email": "ada@example.com",
        "name": "Ada",
        "is_staff": False,
        "is_superuser": False,
        "permissions": [],
    }
    assert anonymous.get("/api/auth/me/").status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"email": "ada@example.com", "password": "wrong-password"},
        {"email": "nobody@example.com", "password": PASSWORD},
    ],
)
def test_login_rejects_wrong_credentials_the_same_way(
    anonymous: APIClient, user: User, body: dict
) -> None:
    response = anonymous.post("/api/auth/login/", body)

    assert response.status_code == 401
    assert response.json() == {"detail": "The email or the password is wrong."}
    assert anonymous.get("/api/auth/me/").status_code == 401


def test_login_rejects_an_inactive_account(anonymous: APIClient, user: User) -> None:
    User.objects.filter(pk=user.pk).update(is_active=False)

    response = anonymous.post("/api/auth/login/", {"email": user.email, "password": PASSWORD})

    assert response.status_code == 401


def test_login_needs_both_fields(anonymous: APIClient, user: User) -> None:
    assert anonymous.post("/api/auth/login/", {"email": user.email}).status_code == 400


def test_logout_ends_the_session(client: APIClient) -> None:
    assert client.post("/api/auth/logout/").status_code == 204
    assert client.get("/api/auth/me/").status_code == 401


@pytest.mark.django_db
def test_logout_and_me_need_a_session(anonymous: APIClient) -> None:
    assert anonymous.post("/api/auth/logout/").status_code == 401
    assert anonymous.get("/api/auth/me/").status_code == 401


@pytest.mark.django_db
def test_me_sets_the_csrf_cookie_even_when_signed_out(anonymous: APIClient) -> None:
    response = anonymous.get("/api/auth/me/")

    assert response.status_code == 401
    assert response.cookies["csrftoken"].value


def _reset_link_parts() -> tuple[str, str]:
    assert len(mail.outbox) == 1
    match = re.search(
        r"http://localhost:5173/reset-password\?uid=([\w-]+)&token=([\w-]+)", mail.outbox[0].body
    )
    assert match
    return match.group(1), match.group(2)


def test_password_reset_changes_the_password(anonymous: APIClient, user: User) -> None:
    assert (
        anonymous.post("/api/auth/password-reset/", {"email": "ADA@example.com"}).status_code == 204
    )
    assert mail.outbox[0].to == ["ada@example.com"]
    uid, token = _reset_link_parts()

    new_password = "a-brand-new-passphrase"
    confirm = {"uid": uid, "token": token, "password": new_password}
    assert anonymous.post("/api/auth/password-reset/confirm/", confirm).status_code == 204

    assert (
        anonymous.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}).status_code
        == 401
    )
    assert (
        anonymous.post(
            "/api/auth/login/", {"email": user.email, "password": new_password}
        ).status_code
        == 200
    )
    # The link works once.
    assert anonymous.post("/api/auth/password-reset/confirm/", confirm).status_code == 400


@pytest.mark.django_db
def test_password_reset_answers_the_same_for_an_unknown_email(anonymous: APIClient) -> None:
    response = anonymous.post("/api/auth/password-reset/", {"email": "nobody@example.com"})

    assert response.status_code == 204
    assert mail.outbox == []


def test_password_reset_confirm_rejects_bad_tokens_and_weak_passwords(
    anonymous: APIClient, user: User
) -> None:
    anonymous.post("/api/auth/password-reset/", {"email": user.email})
    uid, token = _reset_link_parts()
    url = "/api/auth/password-reset/confirm/"
    good = "a-brand-new-passphrase"

    assert anonymous.post(url, {"uid": uid, "token": "wrong", "password": good}).status_code == 400
    assert anonymous.post(url, {"uid": "!!", "token": token, "password": good}).status_code == 400
    assert anonymous.post(url, {"uid": uid, "token": token}).status_code == 400
    weak = anonymous.post(url, {"uid": uid, "token": token, "password": "12345678"})
    assert weak.status_code == 400
    assert "password" in weak.json()
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


THROTTLED = {
    "DEFAULT_THROTTLE_RATES": {
        "user": "1000/min",
        "login_ip": "5/min",
        "login_email": "5/min",
        "auth_ip": "20/min",
    }
}


def _with_rates(rates: dict) -> override_settings:
    from django.conf import settings

    return override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, **rates})


def test_login_is_throttled_per_ip(anonymous: APIClient, user: User) -> None:
    with _with_rates(THROTTLED):
        for attempt in range(5):
            body = {"email": f"someone{attempt}@example.com", "password": "wrong-password"}
            assert anonymous.post("/api/auth/login/", body).status_code == 401
        blocked = anonymous.post("/api/auth/login/", {"email": user.email, "password": PASSWORD})

    assert blocked.status_code == 429
    assert "Retry-After" in blocked


def test_login_is_throttled_per_email_across_ips(user: User) -> None:
    body = {"email": user.email, "password": "wrong-password"}
    with _with_rates(THROTTLED):
        for attempt in range(5):
            api = APIClient(REMOTE_ADDR=f"10.0.0.{attempt + 1}")
            assert api.post("/api/auth/login/", body).status_code == 401
        fresh = APIClient(REMOTE_ADDR="10.0.0.99")
        blocked = fresh.post("/api/auth/login/", {"email": "ADA@example.com", "password": PASSWORD})
        other = fresh.post("/api/auth/login/", {"email": "x@example.com", "password": PASSWORD})

    assert blocked.status_code == 429
    assert other.status_code == 401


def test_the_api_is_throttled_per_user(client: APIClient, other_client: APIClient) -> None:
    rates = {"DEFAULT_THROTTLE_RATES": {**THROTTLED["DEFAULT_THROTTLE_RATES"], "user": "3/min"}}
    with _with_rates(rates):
        statuses = [client.get("/api/projects/").status_code for _ in range(4)]
        other = other_client.get("/api/projects/").status_code

    assert statuses == [200, 200, 200, 429]
    assert other == 200

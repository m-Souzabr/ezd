"""Test runs (pytest, CI). Reads apps/api/.env if present; every value has a local default."""

from pathlib import Path

import environ

# Before base is imported, so that the settings base reads from the environment see it.
environ.Env.read_env(Path(__file__).resolve().parent.parent.parent / ".env")

from .base import *

SECRET_KEY = env.str("DJANGO_SECRET_KEY", default="test-only-insecure-secret-key")
DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]

DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://ezd:ezd@localhost:5432/ezd"),
}

# Fast hashing keeps user-creating tests quick.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# High enough that only the tests that lower them are throttled.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    "DEFAULT_THROTTLE_RATES": {
        "user": "100000/min",
        "login_ip": "100000/min",
        "login_email": "100000/min",
        "auth_ip": "100000/min",
    },
}

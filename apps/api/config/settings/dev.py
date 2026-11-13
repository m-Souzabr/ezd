"""Local development. Reads apps/api/.env if present; every value has a local default."""

from pathlib import Path

import environ

# Before base is imported, so that the settings base reads from the environment see it.
environ.Env.read_env(Path(__file__).resolve().parent.parent.parent / ".env")

from .base import *

SECRET_KEY = env.str("DJANGO_SECRET_KEY", default="dev-only-insecure-secret-key")
DEBUG = env.bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://ezd:ezd@localhost:5432/ezd"),
}

# Password reset emails are printed by `runserver`.
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# The Vite dev server proxies /api here, so the browser's origin is the web app's.
CSRF_TRUSTED_ORIGINS = env.list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default=["http://localhost:5173", "http://127.0.0.1:5173"],
)

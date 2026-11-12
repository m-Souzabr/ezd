"""Test runs (pytest, CI). Reads apps/api/.env if present; every value has a local default."""

from .base import *

env.read_env(BASE_DIR / ".env")

SECRET_KEY = env.str("DJANGO_SECRET_KEY", default="test-only-insecure-secret-key")
DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]

DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://ezd:ezd@localhost:5432/ezd"),
}

# Fast hashing keeps user-creating tests quick.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

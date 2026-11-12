"""Settings shared by every environment.

Environment-specific values (secret key, debug, hosts, database) are set in dev.py,
test.py and prod.py, which all read them from environment variables through `env`.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent
# The repository root in a checkout. The API image sets the two paths below instead.
REPO_DIR = BASE_DIR.parent.parent

env = environ.Env()

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "accounts",
    "projects",
]

MIDDLEWARE = [
    "config.logging.RequestLogMiddleware",
    "config.api.BodyLimitMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Session cookies, never tokens in JavaScript. `Secure` is added in prod.py.
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# The web app reads the CSRF cookie to send it back in the X-CSRFToken header.
CSRF_COOKIE_HTTPONLY = False
CSRF_FAILURE_VIEW = "config.views.csrf_failure"

# The most Django reads of any request body. Each view accepts less: 2 MB unless it sets
# `max_body_bytes` (see config.api).
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["config.api.LimitedJSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["config.api.SessionAuth"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": ["config.api.UserThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "user": env.str("API_THROTTLE_USER", default="600/min"),
        "login_ip": "5/min",
        "login_email": "5/min",
        "auth_ip": "20/min",
    },
    # How many proxies sit in front of the API, to find the client address for throttling.
    "NUM_PROXIES": env.int("DJANGO_NUM_PROXIES", default=0),
    "EXCEPTION_HANDLER": "config.api.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "EZDesign API",
    "VERSION": "1",
    "SCHEMA_PATH_PREFIX": "/api/",
    "COMPONENT_SPLIT_REQUEST": True,
}

# Where the web app is served, for the link in the password reset email.
FRONTEND_URL = env.str("FRONTEND_URL", default="http://localhost:5173")
DEFAULT_FROM_EMAIL = env.str("DJANGO_DEFAULT_FROM_EMAIL", default="EZDesign <no-reply@localhost>")

# The JSON Schema generated from core, and the command that runs `ezd-core`.
DESIGN_DOCUMENT_SCHEMA_PATH = env.str(
    "DESIGN_DOCUMENT_SCHEMA_PATH",
    default=str(REPO_DIR / "packages/core/schema/design-document.schema.json"),
)
EZD_CORE_CLI = env.list(
    "EZD_CORE_CLI",
    default=["node", str(REPO_DIR / "packages/core-cli/bin/ezd-core.js")],
)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "config.logging.JsonFormatter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": env.str("DJANGO_LOG_LEVEL", default="INFO")},
    # `runserver` prints a line per request of its own; the middleware's line replaces it.
    "loggers": {"django.server": {"level": "WARNING"}},
}

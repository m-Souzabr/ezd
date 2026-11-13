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
    "controlpanel",
    "projects",
    "quotes",
    "llm",
    "chat",
    "photos",
]

MIDDLEWARE = [
    "config.logging.RequestLogMiddleware",
    "config.api.BodyLimitMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "config.headers.SecurityHeadersMiddleware",
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

# Django's defaults, stated so a change is deliberate. HSTS is set in prod.py.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

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
        "login_ip": env.str("API_THROTTLE_LOGIN_IP", default="5/min"),
        "login_email": env.str("API_THROTTLE_LOGIN_EMAIL", default="5/min"),
        "auth_ip": env.str("API_THROTTLE_AUTH_IP", default="20/min"),
        "llm": env.str("API_THROTTLE_LLM", default="20/min"),
        "upload": env.str("API_THROTTLE_UPLOAD", default="30/min"),
    },
    # How many proxies sit in front of the API, to find the client address for throttling.
    "NUM_PROXIES": env.int("DJANGO_NUM_PROXIES", default=0),
    "EXCEPTION_HANDLER": "config.api.exception_handler",
    "DEFAULT_PAGINATION_CLASS": "config.pagination.HeaderLimitOffsetPagination",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "EZDesign API",
    "VERSION": "1",
    "SCHEMA_PATH_PREFIX": "/api/",
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {"PhotoDraftStatusEnum": "photos.models.PhotoDraft.Status"},
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

# The seed catalog as JSON, written by core: the first published catalog.
CATALOG_SEED_PATH = env.str(
    "CATALOG_SEED_PATH", default=str(REPO_DIR / "packages/core/schema/catalog.seed.json")
)

# The chat assistant. LLM_VENDOR picks a client from LLM_CLIENTS: "openai" for the real
# model, "fake" for tests and CI. The API key and model names entered by staff on the AI
# settings page override LLM_API_KEY and the three model names.
LLM_VENDOR = env.str("LLM_VENDOR", default="openai")
LLM_CLIENTS = {
    "openai": "llm.openai_client.OpenAIClient",
    "fake": "llm.fake.FakeClient",
}
LLM_API_KEY = env.str("LLM_API_KEY", default="")
# With LLM_VENDOR "fake": a JSON file of scripted answers, for the end-to-end tests.
LLM_FAKE_SCRIPT = env.str("LLM_FAKE_SCRIPT", default="")
# 32 bytes, base64. Encrypts the stored API key; derived from SECRET_KEY when empty.
LLM_SECRET_KEY = env.str("LLM_SECRET_KEY", default="")
LLM_ROUTER_MODEL = env.str("LLM_ROUTER_MODEL", default="gpt-5.4-nano")
LLM_DEFAULT_MODEL = env.str("LLM_DEFAULT_MODEL", default="gpt-5.4-mini")
LLM_ESCALATION_MODEL = env.str("LLM_ESCALATION_MODEL", default="gpt-5.5")
LLM_TIMEOUT_SECONDS = env.float("LLM_TIMEOUT_SECONDS", default=60.0)
LLM_MAX_MESSAGE_CHARS = env.int("LLM_MAX_MESSAGE_CHARS", default=2000)
LLM_MAX_SUMMARY_CHARS = env.int("LLM_MAX_SUMMARY_CHARS", default=12000)
LLM_MAX_OUTPUT_TOKENS = env.int("LLM_MAX_OUTPUT_TOKENS", default=4000)
LLM_MONTHLY_TOKEN_QUOTA = env.int("LLM_MONTHLY_TOKEN_QUOTA", default=2_000_000)
# How many earlier turns are sent to the model in full.
LLM_HISTORY_TURNS = env.int("LLM_HISTORY_TURNS", default=6)
# The tools and the catalog index, generated by core like the document schema.
LLM_TOOLS_SCHEMA_PATH = env.str(
    "LLM_TOOLS_SCHEMA_PATH", default=str(REPO_DIR / "packages/core/schema/llm-tools.schema.json")
)
LLM_CATALOG_INDEX_PATH = env.str(
    "LLM_CATALOG_INDEX_PATH",
    default=str(REPO_DIR / "packages/core/schema/llm-catalog-index.txt"),
)

# Photo import. The vision model is the chat's default model unless LLM_MODEL_VISION names
# another. Analysis runs inside the request, so its timeout is longer than the chat's.
LLM_MODEL_VISION = env.str("LLM_MODEL_VISION", default="")
LLM_PHOTO_TIMEOUT_SECONDS = env.float("LLM_PHOTO_TIMEOUT_SECONDS", default=180.0)
LLM_PHOTO_MAX_OUTPUT_TOKENS = env.int("LLM_PHOTO_MAX_OUTPUT_TOKENS", default=8000)
# The model's answer and the stored draft, generated by core like the document schema.
DRAFT_ROOM_SCHEMA_PATH = env.str(
    "DRAFT_ROOM_SCHEMA_PATH",
    default=str(REPO_DIR / "packages/core/schema/draft-room.schema.json"),
)
ROOM_DRAFT_SCHEMA_PATH = env.str(
    "ROOM_DRAFT_SCHEMA_PATH",
    default=str(REPO_DIR / "packages/core/schema/room-draft.schema.json"),
)
# An upload's size, and the pixels it may decode to: a larger image is refused as a
# possible decompression bomb. Stored photos are downscaled to PHOTO_MAX_EDGE.
PHOTO_MAX_BYTES = env.int("PHOTO_MAX_BYTES", default=10 * 1024 * 1024)
PHOTO_MAX_PIXELS = env.int("PHOTO_MAX_PIXELS", default=50_000_000)
PHOTO_MAX_EDGE = env.int("PHOTO_MAX_EDGE", default=2000)

# Uploaded photos. Never served from MEDIA_ROOT or a public bucket: only the authenticated
# `/api/photos/{id}/file/` endpoint reads them. STORAGE_BACKEND "s3" keeps them in an
# S3-compatible bucket, which must be private.
MEDIA_ROOT = env.str("MEDIA_ROOT", default="") or str(BASE_DIR / "media")
_STORAGE_BACKEND = env.str("STORAGE_BACKEND", default="filesystem")
STORAGES = {
    "default": (
        {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {
                "bucket_name": env.str("S3_BUCKET"),
                "endpoint_url": env.str("S3_ENDPOINT_URL", default="") or None,
                "region_name": env.str("S3_REGION", default="") or None,
                "access_key": env.str("S3_ACCESS_KEY_ID"),
                "secret_key": env.str("S3_SECRET_ACCESS_KEY"),
                "default_acl": "private",
                "file_overwrite": False,
            },
        }
        if _STORAGE_BACKEND == "s3"
        else {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    ),
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# The eval suite (`manage.py run_evals`), and the prices it reports cost with: US dollars
# per million tokens. Check them on the vendor's pricing page; they change.
EVALS_DIR = env.str("EVALS_DIR", default=str(REPO_DIR / "evals"))
LLM_PRICES = {
    "gpt-5.4-nano": {"input": 0.20, "cached_input": 0.02, "output": 1.25},
    "gpt-5.4-mini": {"input": 0.75, "cached_input": 0.075, "output": 4.50},
    "gpt-5.5": {"input": 5.00, "cached_input": 0.50, "output": 30.00},
}

# A dotted path to `fn(error, context)` that sends unexpected errors to a tracker, or empty.
ERROR_REPORTER = env.str("ERROR_REPORTER", default="")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "config.logging.JsonFormatter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": env.str("DJANGO_LOG_LEVEL", default="INFO")},
    # `runserver` prints a line per request of its own; the middleware's line replaces it.
    "loggers": {"django.server": {"level": "WARNING"}},
}

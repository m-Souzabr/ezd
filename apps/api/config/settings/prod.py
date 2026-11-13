"""Production. Every value is required from the environment; there are no defaults."""

from .base import *

SECRET_KEY = env.str("DJANGO_SECRET_KEY")
DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

DATABASES = {
    "default": env.db("DATABASE_URL"),
}

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# For example smtp+tls://user:password@host:587
EMAIL_CONFIG = env.email("EMAIL_URL")
vars().update(EMAIL_CONFIG)

# Throttle counters. The default is per process; point it at a shared cache when the API
# runs as more than one process, or each process counts on its own.
CACHES = {"default": env.cache("CACHE_URL", default="locmemcache://")}

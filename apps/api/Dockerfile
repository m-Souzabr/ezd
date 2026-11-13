# The EZDesign API. Build from the repository root, because the image also needs the
# JSON Schema and the `ezd-core` CLI that come from packages/:
#
#   docker build -f apps/api/Dockerfile -t ezd-api .

# 1. Bundle the CLI into one file. The API runs it to validate documents with core.
FROM node:24-slim AS core
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/core-cli/package.json packages/core-cli/
RUN pnpm install --frozen-lockfile --filter @ezd/core-cli...
COPY packages/core packages/core
COPY packages/core-cli packages/core-cli
RUN pnpm --filter @ezd/core-cli build

# 2. The API itself, with Node only to run that file.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=core /usr/local/bin/node /usr/local/bin/node

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=config.settings.prod \
    DESIGN_DOCUMENT_SCHEMA_PATH=/opt/ezd/design-document.schema.json \
    EZD_CORE_CLI=node,/opt/ezd/cli.js \
    CATALOG_SEED_PATH=/opt/ezd/catalog.seed.json \
    LLM_TOOLS_SCHEMA_PATH=/opt/ezd/llm-tools.schema.json \
    LLM_CATALOG_INDEX_PATH=/opt/ezd/llm-catalog-index.txt \
    DRAFT_ROOM_SCHEMA_PATH=/opt/ezd/draft-room.schema.json \
    ROOM_DRAFT_SCHEMA_PATH=/opt/ezd/room-draft.schema.json \
    MEDIA_ROOT=/app/media

WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/.python-version ./
RUN uv sync --frozen --no-dev
COPY apps/api ./
COPY --from=core /repo/packages/core-cli/dist/cli.js /opt/ezd/cli.js
COPY packages/core/schema/design-document.schema.json /opt/ezd/design-document.schema.json
COPY packages/core/schema/catalog.seed.json /opt/ezd/catalog.seed.json
COPY packages/core/schema/llm-tools.schema.json /opt/ezd/llm-tools.schema.json
COPY packages/core/schema/llm-catalog-index.txt /opt/ezd/llm-catalog-index.txt
COPY packages/core/schema/draft-room.schema.json /opt/ezd/draft-room.schema.json
COPY packages/core/schema/room-draft.schema.json /opt/ezd/room-draft.schema.json

# Uploaded photos, unless STORAGE_BACKEND is s3. Mount a volume here to keep them.
RUN useradd --system --no-create-home ezd && mkdir -p /app/media && chown ezd /app/media
USER ezd
EXPOSE 8000
# Migrations run at start so `docker compose up` gives a working API.
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --access-logfile /dev/null"]

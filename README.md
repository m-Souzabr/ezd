# EZDesign

EZDesign is a web-based kitchen design tool. Users create and adjust kitchen layouts by
chat, by photo upload and by drag and drop. Every one of those is a client of a single
typed, versioned **Design Document**, and every change to it goes through one command layer.

The plan lives in [issue #1](https://github.com/m-Souzabr/ezd/issues/1). Contributor and
code-agent rules are in [AGENTS.md](AGENTS.md); the package dependency direction is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
packages/core/      @ezd/core      pure TypeScript domain (no React, DOM or Node APIs)
packages/core-cli/  @ezd/core-cli  Node CLI wrapping core for Python callers
apps/web/           @ezd/web       React + Vite app
apps/api/           Django project (Python)
```

## Prerequisites

| Tool                                          | Version                  |
| --------------------------------------------- | ------------------------ |
| [Node.js](https://nodejs.org)                 | 24 (see `.nvmrc`)        |
| [pnpm](https://pnpm.io)                       | 12 (`corepack enable`)   |
| [uv](https://docs.astral.sh/uv/)              | current                  |
| [Docker](https://www.docker.com) with Compose | current (for PostgreSQL) |

uv installs Python 3.13 by itself; you do not need a system Python.

## Install

```sh
pnpm install                  # all JS workspaces
cd apps/api && uv sync        # Python environment in apps/api/.venv
```

## Run

Start PostgreSQL, the API and the web app, each in its own terminal:

```sh
# 1. Database (from apps/api)
cd apps/api
docker compose up -d --wait

# 2. API on http://localhost:8000 (from apps/api)
uv run python manage.py migrate
uv run python manage.py runserver

# 3. Web app on http://localhost:5173 (from apps/web)
cd apps/web
pnpm dev
```

The web dev server proxies `/api` to the API, so
<http://localhost:5173/api/health/> answers `{"status": "ok"}`.

The editor does not need the API yet: it keeps the design in the browser's `localStorage`,
so `pnpm dev` alone is enough to use it.

The API works with no configuration. To change anything (for example when port 5432 is
already in use), copy `apps/api/.env.example` to `apps/api/.env` and edit it; set
`POSTGRES_PORT` and `DATABASE_URL` together.

## Test and check

JavaScript, from the repository root (each command runs in every workspace):

```sh
pnpm test            # Vitest
pnpm lint            # ESLint
pnpm typecheck       # tsc
pnpm build           # core, core-cli and web builds
pnpm format          # Prettier (pnpm format:check to verify only)
```

End-to-end tests of the editor, in a real browser (Playwright starts the web dev server
itself):

```sh
pnpm --filter @ezd/web exec playwright install chromium   # once
pnpm --filter @ezd/web e2e
```

Python, from `apps/api` (pytest needs the database from `docker compose up`):

```sh
uv run pytest
uv run ruff check
uv run ruff format   # add --check to verify only
```

Dependency licenses, from the repository root. Only the licenses listed in
`licenses.allow.json` are accepted:

```sh
pnpm run licenses       # JS
pnpm run licenses:py    # Python
```

Use `pnpm run licenses`, not `pnpm licenses`: the bare form is a built-in pnpm command.

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request and on pushes
to `main`.

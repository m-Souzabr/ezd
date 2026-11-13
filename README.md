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
apps/web/           @ezd/web       React + Vite app, its Playwright tests (e2e/, perf/)
apps/api/           Django project (Python)
evals/              chat eval cases and the photo test set, with recorded answers
docs/               architecture, operations, security, performance, browsers, rules
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

The editor at <http://localhost:5173/> does not need the API: it keeps one design in the
browser's `localStorage`, so `pnpm dev` alone is enough to try it. Accounts, projects,
saved designs and version history need the API and the database. The API validates each
document with the `ezd-core` CLI, so build that once (and again after changing core):

```sh
pnpm --filter @ezd/core-cli build
```

Password reset emails are printed in the `runserver` terminal.

To run the API in a container instead, next to PostgreSQL (from `apps/api`):

```sh
docker compose --profile api up --build
```

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

End-to-end tests of the editor, in a real browser. Playwright starts the web dev server
and the API itself; the API needs PostgreSQL running and uses a database of its own
(`test_ezd`):

```sh
pnpm --filter @ezd/web exec playwright install chromium   # once
pnpm --filter @ezd/web e2e
```

Python, from `apps/api` (pytest needs the database from `docker compose up` and the CLI
built with `pnpm --filter @ezd/core-cli build`):

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

After changing an API endpoint or serializer, regenerate the OpenAPI file and the web
app's types, and commit both:

```sh
pnpm run openapi
```

Other checks, from the repository root:

```sh
pnpm --filter @ezd/web bundle-size   # after pnpm build: the editor's initial JS, gzipped
pnpm --filter @ezd/web perf          # drag frame rate and cold load, on the production build
pnpm run todos                       # every TODO or FIXME links an issue
pnpm run licenses:report             # licenses-report/, attached to a release
```

The assistant's eval suites, from `apps/api` (`--client fake` replays recorded answers, as
CI does; `--client live` needs an API key):

```sh
uv run python manage.py run_evals --client fake
uv run python manage.py run_photo_evals --client fake
```

CI (`.github/workflows/ci.yml`) runs all of the above but `perf` on every pull request and
on pushes to `main`, plus a secret scan and dependency audits.

## Documentation

| Document                                     | What it covers                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Packages, how a change flows through core, where things live           |
| [docs/EXTENDING.md](docs/EXTENDING.md)       | Collaboration, vendor catalogs, bath and closet, other LLM vendors, 3D |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)     | Deployment, health checks, error reporting, backups and restore        |
| [docs/SECURITY.md](docs/SECURITY.md)         | Controls, CI checks and the security review                            |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)   | Targets and measured numbers                                           |
| [docs/BROWSERS.md](docs/BROWSERS.md)         | Browser support and test results                                       |
| [docs/RULES.md](docs/RULES.md)               | Every design rule, generated from the code                             |

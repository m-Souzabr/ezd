# Operations

How EZDesign runs in production, how to check it is healthy, and how to back it up and
restore it. Production infrastructure beyond this page is out of scope for v1.

## Services

| Service    | Built from                               | Serves                                                 |
| ---------- | ---------------------------------------- | ------------------------------------------------------ |
| `web`      | `apps/web/Dockerfile` (Caddy)            | The built web app; proxies `/api/*` to the API         |
| `api`      | `apps/api/Dockerfile` (Django, gunicorn) | `/api/*`; runs migrations on start; private, port 8000 |
| PostgreSQL | managed by the host                      | Everything but uploaded photos                         |
| Photos     | `/app/media` in the API, or an S3 bucket | Uploaded photos (`STORAGE_BACKEND`)                    |

On Railway, `main` deploys both services on every merge (`apps/*/railway.json`). Every
environment variable is listed, with its default, in `apps/api/.env.example`. Production
reads them through `config.settings.prod`, which has no defaults for the required ones:
`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DATABASE_URL` and `EMAIL_URL`.

## Health

| Endpoint           | Checks                       | Use it for                        |
| ------------------ | ---------------------------- | --------------------------------- |
| `GET /api/health/` | The process answers          | Liveness: restart when it fails   |
| `GET /api/ready/`  | A `SELECT 1` on the database | Readiness: route traffic when 200 |

`/api/ready/` answers 503 `{"status": "database unavailable"}` when the database cannot be
reached. Point the API service's health check at it.

## Logs

The API writes one JSON line per request (`config/logging.py`): request id, method, path
without its query string, status, duration and user id. Calls to the language model add the
model, token counts, latency, attempt and outcome. Nothing else is logged: no request or
response bodies, cookies, passwords, emails, prompts, documents, photos or API keys. Each
response carries the request id in `X-Request-Id`, to find its line.

## Error reporting

Both sides have a hook that does nothing until an adapter is set.

**API.** Set `ERROR_REPORTER` to the dotted path of a function `report(error, context)`.
Every unhandled exception in a request is passed to it, with the method and path. For
example, with Sentry's SDK (MIT), add `sentry-sdk` with `uv add`, then:

```python
# apps/api/config/sentry.py
import sentry_sdk

sentry_sdk.init(dsn="...", send_default_pii=False)


def report(error, context):
    with sentry_sdk.new_scope() as scope:
        scope.set_context("request", context)
        sentry_sdk.capture_exception(error)
```

and `ERROR_REPORTER=config.sentry.report`.

**Web.** Call `setErrorReporter` (`apps/web/src/lib/reportError.ts`) once in `main.tsx`.
Crashes caught by the error boundary, uncaught errors and unhandled promise rejections are
reported, with a small context (`where`, the React component stack). Never add design
content, photos, emails or keys to the context.

On a crash the web app shows a page with **Reload** and **Download my design (JSON)**.
Autosave has already sent the design to the server, or kept it in the browser if the
server could not be reached; the download is a copy as of the moment before the crash.

## Backups

**The database** holds every account, project, design, version, quote, chat and photo
draft. Back it up daily and before every migration:

```sh
pg_dump --format=custom --no-owner --file=ezd-$(date +%F).dump "$DATABASE_URL"
```

On Railway, also turn on the PostgreSQL service's scheduled backups. Keep at least 14 daily
copies, outside the database's own host.

**Photos** are not in the database. With `STORAGE_BACKEND=filesystem` they are in
`/app/media`, which must be a mounted volume (without one, a redeploy deletes them): copy
the volume with the database backup. With `STORAGE_BACKEND=s3`, turn on versioning on the
bucket. A database row whose photo file is missing shows as a broken image; nothing else
breaks.

**Secrets** are not in either backup: keep `DJANGO_SECRET_KEY` and `LLM_SECRET_KEY` in the
host's secret store. The vendor API key stored in AI settings is encrypted with
`LLM_SECRET_KEY` (or, when that is empty, a key derived from `DJANGO_SECRET_KEY`). Restoring
the database with a different key leaves the stored API key unreadable; an administrator
then enters it again. Changing `DJANGO_SECRET_KEY` also signs everyone out.

## Restore

1. Stop the API service, so nothing writes during the restore.
2. Restore into an empty database:

   ```sh
   createdb ezd_restore
   pg_restore --no-owner --dbname=ezd_restore ezd-2026-11-13.dump
   ```

3. Point `DATABASE_URL` at it (or rename it over the old one), and restore the photos
   volume or bucket from the same date.
4. Start the API. It runs `migrate` on start, which brings an older backup up to the
   current schema. Check `/api/ready/`, sign in, and open a design and a quote PDF.

Practise this on a copy at least once per release; an untested backup is not a backup.

## Releases

1. Every CI job is green on `main`.
2. Run **Actions → Evals (live)** and read both reports (chat and photos).
3. Generate the license report (`pnpm run licenses:report`; CI also uploads it as the
   `license-report` artifact) and attach it to the release.
4. Tag the merge commit (`git tag v1.0.0`) and publish release notes.

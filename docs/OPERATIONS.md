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

A healthy answer also says whether the published configuration is usable:

```json
{ "status": "ok", "config": "ok", "catalog": "ok" }
```

`config` and `catalog` are `ok` (a published version exists, parses and satisfies every
rule), `defaults` (nothing is published yet, so the compiled-in defaults apply), `invalid`
or `unknown` (`ezd-core` could not be run). A published row never changes, so the check
runs once per version and process. `invalid` never fails the probe: the app falls back to
its defaults field by field, and the Control Panel must stay reachable to roll the bad
version back. Alert on it instead of restarting.

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

## The Control Panel

### A bad publish

Every publish of the catalog, the rules, the app settings or the quote defaults can be
undone in the Control Panel. Open the section, find the last good version in **Version
history** and choose **Roll back**, then confirm. That publishes a copy of the old version as
a new one; nothing is deleted, and quotes already made keep the catalog version they were
priced with. Use **Compare versions** first to see what a version changed, and the audit
log (`Audit`, filter by object type `config_version` or `catalog_version`) to see who
published it.

If the Control Panel cannot be opened, roll back through the API as a user who holds the
permission (the session cookie and the CSRF token are the browser's, so this is easiest from
the browser console on the site):

```sh
POST /api/admin/config/versions/<number>/rollback/      # rules, app settings, quote defaults
POST /api/admin/catalog/versions/<catalog-n>/rollback/  # the catalog
```

### A lost superuser

If nobody can sign in as an administrator, run these on the API service (on Railway, from
the service's shell). Neither needs the web app.

```sh
uv run python manage.py createsuperuser                     # a new account, or
uv run python manage.py grant_administrator me@example.com  # an existing one
uv run python manage.py grant_administrator me@example.com --superuser
```

`grant_administrator` makes the account active and staff and puts it in the Administrator
role (with `--superuser`, a superuser too). It writes an audit entry with no actor, so the
log shows it was done from the command line.

### What is backed up with the database

Every configuration version (the app settings, rules and quote defaults in `ConfigVersion`,
the catalog in `CatalogVersion`), the audit log and the roles are rows in PostgreSQL, so
the database backup under **Backups** holds all of them, history included. A published row is
never updated or deleted, so any backup contains every version that existed when it was
taken. To keep a copy outside the database, use **Backup and reset → Export** (and Export
in a version history for an older one): one JSON file that **Import** reads back as a draft.
An import never publishes, and a file with any invalid section changes nothing.

### The audit log

`AUDIT_RETENTION_DAYS` (default `0`, keep everything) says how long entries are kept. The
log is pruned only when you run it, for example from a daily scheduled job:

```sh
uv run python manage.py prune_audit             # uses AUDIT_RETENTION_DAYS
uv run python manage.py prune_audit --days 365  # an explicit number
uv run python manage.py prune_audit --days 365 --dry-run
```

It records an `audit.prune` entry with the number deleted. The audit page exports the rows
that match its filters as CSV (`audit.view`); secrets are masked in the log itself, not only
in the export.

### Limits

Control Panel routes (`admin-*`) have their own throttle, `API_THROTTLE_ADMIN` (default
`120/min` per user), and the catalog draft, config draft and import accept bodies of at
most 1 MB, 512 KB and 2 MB. A quote logo is decoded, shrunk to `LOGO_MAX_EDGE` (800 px)
and re-encoded on the server, and refused above `LOGO_MAX_PIXELS`.

### Admin errors

A failed Control Panel request that is not an expected outcome (a server fault, a throttle, a
request with no answer) is passed to `reportError` with the method, the status and the
section of the path (`admin/catalog/entries`). The message and body are not sent, so a
report never holds configuration contents or an email address.

## Releases

1. Every CI job is green on `main`.
2. Run **Actions → Evals (live)** and read both reports (chat and photos).
3. Generate the license report (`pnpm run licenses:report`; CI also uploads it as the
   `license-report` artifact) and attach it to the release.
4. Tag the merge commit (`git tag v1.0.0`) and publish release notes.

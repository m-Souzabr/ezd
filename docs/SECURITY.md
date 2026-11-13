# Security

How EZDesign protects accounts and their data, what is checked automatically, and the
findings of the v1 security review.

## What CI checks

| Check                   | Where                                    | Fails on                               |
| ----------------------- | ---------------------------------------- | -------------------------------------- |
| Secret scan             | `security` job, gitleaks                 | any secret in the history (1)          |
| JS dependency audit     | `security` job, `pnpm audit`             | a high or critical advisory            |
| Python dependency audit | `security` job, `pip-audit` (via `uvx`)  | any known vulnerability (2)            |
| Licenses                | `licenses` job                           | a license not on the allowlist         |
| Ownership               | `apps/api/tests/test_isolation.py`       | a route another account can reach      |
| Authentication          | same file                                | a route that answers without a session |
| Security headers        | `apps/api/tests/test_security.py`        | a missing header                       |
| Throttles, body limits  | `test_security.py`, `test_validation.py` | a limit that does not hold             |

1. `.gitleaksignore` lists two test fixtures by fingerprint: a fake API key and base64 of
   placeholder text in `apps/api/tests/test_llm.py`, also marked `gitleaks:allow` inline.
2. `pip-audit` cannot filter by severity, so it is stricter than the high-severity bar.

## Controls, endpoint by endpoint

Every route under `/api/` was checked for the five controls #12 lists.

- **Authentication.** Session cookies (`HttpOnly`, `SameSite=Lax`, `Secure` in production).
  Every route needs a session except health, readiness, register, login and password reset;
  `test_isolation.py` fails if a new route is added without being listed.
- **Owner scoping.** Every view reads through `OwnedQuerysetMixin` and the models'
  `for_user`, so another account's object is a 404, never a 403. Photos, photo drafts and
  photo files are included. An archived project hides everything in it.
- **CSRF.** Django's middleware on every unsafe method, anonymous ones included.
- **Throttling.** 600 requests a minute per user; sign-in 5 a minute per address and per
  email; registration and reset 20 a minute per address; model calls (chat, retry, photo
  analysis) 20 a minute per user, plus a monthly token quota; photo uploads 30 a minute per
  user. All are environment variables (`API_THROTTLE_*`).
- **Body size.** 2 MB unless a view sets more: a quote with its drawings 12 MB, a photo
  upload 10 MB plus the multipart envelope. A declared length over the limit is refused
  before the body is read.

## Uploads

Photos (`apps/api/photos/images.py`): the type is read from the content (JPEG, PNG or WebP),
never from the name or the declared type; the pixel count is capped before decoding
(`PHOTO_MAX_PIXELS`), and Pillow's decompression-bomb warning is treated as an error. The
image is decoded, turned upright, copied onto a fresh RGB image so no metadata survives
(EXIF, GPS, ICC profiles, comments), downscaled and re-encoded as JPEG. Files have random
names, live in private storage, and are served only by `/api/photos/{id}/file/` to their
owner with `nosniff`.

## Response headers

| Header                    | Web (Caddy)                                  | API (Django)                    |
| ------------------------- | -------------------------------------------- | ------------------------------- |
| Content-Security-Policy   | scripts from the site only, no inline script | `default-src 'none'` on `/api/` |
| X-Content-Type-Options    | `nosniff`                                    | `nosniff`                       |
| X-Frame-Options           | `DENY`, and `frame-ancestors 'none'`         | `DENY`                          |
| Referrer-Policy           | `strict-origin-when-cross-origin`            | `same-origin`                   |
| Strict-Transport-Security | one year, subdomains                         | one year, subdomains (prod)     |
| Permissions-Policy        | camera, microphone, geolocation off          | the same                        |

The web policy allows inline _styles_: the dialogs' scroll lock adds a `<style>` element.
The production build was served with this header (`vite preview`) and driven through the
editor in Chromium; the browser reported no violation. The bundles contain no `eval` or
`new Function`.

## The language model

The model never changes a design. Chat answers are tool calls that core converts into one
`batch` and dry-runs; a proposal is applied only when the user accepts it. A photo answer
must match the draft JSON Schema, then core normalizes it, and the user confirms every wall
length before anything becomes a design. User messages, document names and text in photos
are passed as data, and the prompts say so. Injection cases are in the evals:
`injection-name` and `injection-message` (chat), and `single-wall-text` (a photo with a
sign that gives instructions). The vendor API key is stored encrypted (AES-GCM), shown only
by its last four characters, and never logged.

## Logs

Only allowlisted fields are written (`config/logging.py`): no bodies, cookies, passwords,
emails, prompts, documents, photos or keys. The request path is logged without its query
string, which could hold a password reset token.

## Review findings (v1)

The review covered the whole repository: every API route, the upload path, the model
integration, authentication and password reset, secrets, logging, the web app's handling
of the session, and the deployment configuration.

| #   | Finding                                                                                                                 | Severity              | Status                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| 1   | No Content-Security-Policy, Permissions-Policy or HSTS on the web app                                                   | Medium                | Fixed: headers in `apps/web/Caddyfile`                                 |
| 2   | No Content-Security-Policy on API responses                                                                             | Low                   | Fixed: `config/headers.py`                                             |
| 3   | Model calls limited only by the general throttle and the monthly quota                                                  | Medium                | Fixed: `llm` throttle                                                  |
| 4   | Photo uploads, decoded on the server, limited only by the general throttle                                              | Medium                | Fixed: `upload` throttle                                               |
| 5   | No secret scan or dependency audit in CI                                                                                | Medium                | Fixed: `security` job                                                  |
| 6   | A 401 after signing out sent the user to `/login?next=/login`                                                           | Low                   | Fixed: `SessionExpiry` stays on sign-in pages                          |
| 7   | Password reset sends mail only when the account exists, so its response time can hint at whether an email is registered | Low                   | Open: send the mail from a task queue when one is added                |
| 8   | Photos on the container's disk are lost on redeploy without a volume                                                    | Medium (availability) | Documented in `docs/OPERATIONS.md`; needs a volume or S3 in production |
| 9   | The admin site is enabled                                                                                               | Info                  | Accepted: Caddy proxies only `/api/*`, and the API service is private  |

No high-severity finding is open.

# AGENTS.md

Rules for code agents and contributors working on EZDesign. The plan is
[issue #1](https://github.com/m-Souzabr/ezd/issues/1); each phase has its own issue
(#2 to #12). Read the phase issue in full before starting it.

## Ground rules

### Architecture

- The Design Document (typed, versioned JSON) is the single source of truth. 2D, 3D, chat,
  photo import and drag and drop are clients of it.
- Every mutation goes through the command layer in `packages/core`. No code path edits the
  document directly.
- `packages/core` is pure TypeScript: no React, no Three.js, no DOM, no Node-only APIs.
  Renderers depend on core, never the reverse. ESLint and the package `tsconfig.json`
  enforce this.
- The LLM never produces geometry. It only proposes commands, which core validates and
  applies.
- Permissive licenses only (MIT, Apache-2.0, BSD, ISC and similar). No GPL or AGPL. Do not
  copy any third-party product's UI, assets, catalogs, file formats or branding.

### Units

- Inches only. There is no metric code anywhere.
- Every stored length is a `Len`: an integer count of sixteenths of an inch. `1 in = 16`,
  `3 in = 48`, `34.5 in = 552`. Never store a float length.
- Convert to text only at the UI boundary, as inches with fractions (`34 1/2"`).
- Money is integer cents. Angles are integer degrees.

### Cabinet sizes

- Width: a multiple of 3 in, inside the range for the cabinet type.
- Height and depth: one of the US industry-standard values for the cabinet type (table in #4).
- Fillers are the only pieces allowed at an arbitrary width.

### Working rules

- Work on a branch named `phase-N-short-name` and open one pull request per phase (or per
  task group if the phase is large).
- Write the tests listed in the issue. A phase is done only when every acceptance criterion
  passes in CI.
- Do not start work that belongs to a later phase. If something is missing from an earlier
  phase, fix it there first.
- If a requirement in a phase issue conflicts with #1, stop and ask in the issue.

## Repository layout

```
ezd/
  packages/core/      @ezd/core      pure TS domain: schemas, units, commands, catalog, rules, scene, bom
  packages/core-cli/  @ezd/core-cli  Node CLI wrapping core (validate, apply) for Python callers
  apps/web/           @ezd/web       React + Vite app: the 2D editor, and its Playwright tests in e2e/
  apps/api/           Django project (Python)
  evals/              LLM eval cases, their documents and recorded responses; photos/ for photo import
  scripts/            repository tooling (license check)
  .github/workflows/  CI
```

Shared configuration at the root: `tsconfig.base.json`, `eslint.config.js` (exports `base`,
which each package's `eslint.config.js` extends), `.prettierrc`, `licenses.allow.json`, and
the dependency version catalog in `pnpm-workspace.yaml`.

## Toolchain

Node 24 (`.nvmrc`), pnpm 12 (`packageManager` in `package.json`; `corepack enable`),
Python 3.13 managed by uv, PostgreSQL 17 through Docker Compose.

```sh
pnpm install                                  # JS dependencies, from the root
cd apps/api && uv sync                        # Python dependencies
cd apps/api && docker compose up -d --wait    # PostgreSQL for the API and its tests
```

## Commands

### Everything in JS, from the root

| Task             | Command                |
| ---------------- | ---------------------- |
| Lint             | `pnpm lint`            |
| Typecheck        | `pnpm typecheck`       |
| Test             | `pnpm test`            |
| Build            | `pnpm build`           |
| Format           | `pnpm format`          |
| Check formatting | `pnpm format:check`    |
| JS licenses      | `pnpm run licenses`    |
| Python licenses  | `pnpm run licenses:py` |

`pnpm licenses` without `run` is a different, built-in pnpm command. Always use
`pnpm run licenses`.

### One JS package

Run from the root with a filter, or `cd` into the package and drop the filter.

| Package         | Lint                               | Typecheck                               | Test                               | Build                               |
| --------------- | ---------------------------------- | --------------------------------------- | ---------------------------------- | ----------------------------------- |
| `@ezd/core`     | `pnpm --filter @ezd/core lint`     | `pnpm --filter @ezd/core typecheck`     | `pnpm --filter @ezd/core test`     | `pnpm --filter @ezd/core build`     |
| `@ezd/core-cli` | `pnpm --filter @ezd/core-cli lint` | `pnpm --filter @ezd/core-cli typecheck` | `pnpm --filter @ezd/core-cli test` | `pnpm --filter @ezd/core-cli build` |
| `@ezd/web`      | `pnpm --filter @ezd/web lint`      | `pnpm --filter @ezd/web typecheck`      | `pnpm --filter @ezd/web test`      | `pnpm --filter @ezd/web build`      |

- JSON Schema: `pnpm --filter @ezd/core schema` rewrites `packages/core/schema/*` from the
  Zod schemas, including the assistant's tools (`llm-tools.schema.json`) and catalog index
  (`llm-catalog-index.txt`). Run it and commit the result whenever a document or command schema
  changes; CI fails if the committed files are stale.
- Core tests run with coverage and fail below 95 percent of lines or branches.
- Core performance tests are the `*.perf.test.ts` files. `pnpm --filter @ezd/core test` runs
  them in a second pass (`vitest.perf.config.ts`) without coverage, which would distort the
  timings.
- Web dev server: `pnpm --filter @ezd/web dev` (http://localhost:5173, proxies `/api` to
  http://localhost:8000, or to `EZD_API_URL`). The editor at `/` works without the API: it
  keeps one design in `localStorage`. Accounts, projects and saved designs need the API.
- Web end-to-end tests: `pnpm --filter @ezd/web e2e` runs the Playwright tests in
  `apps/web/e2e` against the dev server and the API, both of which it starts itself. The
  API runs as Django's `testserver` on port 8010 with the database `test_ezd`, which it
  empties on each start, so PostgreSQL must be running and `uv sync` done. Install the
  browser once with `pnpm --filter @ezd/web exec playwright install chromium`. They are
  not part of `pnpm test`; CI runs them in the `e2e` job. They read the document through
  `window.__ezd` (`getDoc`, `getHistoryLength`, `getViewport`), which only development and
  test builds expose, and drive the canvas by mouse coordinates.
- Run Prettier from the repository root (`pnpm format`): run from a package, it does not
  read the root `.prettierignore` and rewrites the generated files.
- OpenAPI: `pnpm run openapi` rewrites `apps/api/openapi.yaml` from the API and
  `apps/web/src/api/schema.d.ts` from that file. Run it and commit the result whenever an
  endpoint or a serializer changes; CI fails if the committed files are stale.
- CLI after a build: `node packages/core-cli/bin/ezd-core.js --version`, or
  `node packages/core-cli/bin/ezd-core.js validate-document < design.json`.
  `ezd-core validate` reads `{ document, commands? }` on stdin and prints the rule
  violations; `ezd-core --help` lists every command.

### `apps/api` (Django), from `apps/api`

| Task               | Command                                                    |
| ------------------ | ---------------------------------------------------------- |
| Lint               | `uv run ruff check`                                        |
| Format             | `uv run ruff format`                                       |
| Check formatting   | `uv run ruff format --check`                               |
| Test               | `uv run pytest`                                            |
| Missing migrations | `uv run python manage.py makemigrations --check --dry-run` |
| Apply migrations   | `uv run python manage.py migrate`                          |
| Dev server         | `uv run python manage.py runserver`                        |

| Eval suite (fake) | `uv run python manage.py run_evals --client fake` |
| Eval suite (live) | `uv run python manage.py run_evals --client live --record` |
| Photo evals (fake) | `uv run python manage.py run_photo_evals --client fake` |
| Photo evals (live) | `uv run python manage.py run_photo_evals --client live --record` |

There is no Python typecheck or build step yet. pytest needs PostgreSQL running, and the
built CLI (`pnpm --filter @ezd/core-cli build`), which the API runs to validate documents.

`docker compose --profile api up --build` runs the API in a container next to PostgreSQL,
from `apps/api/Dockerfile` (built from the repository root). A plain `docker compose up`
starts PostgreSQL only.

## Conventions

- **Dependencies.** Add JS dependency versions to the `catalog` in `pnpm-workspace.yaml` and
  reference them as `"catalog:"`. Add Python dependencies with `uv add` (or `uv add --dev`).
  Commit `pnpm-lock.yaml` and `apps/api/uv.lock`.
- **Licenses.** A new dependency must pass the license check. If a license is not on the
  allowlist, choose another dependency. An exception in `licenses.allow.json` needs a
  written reason and the repository owner's approval.
- **Importing core.** `@ezd/core` exports its TypeScript source under the `@ezd/source`
  condition, which the shared tsconfig, Vite, Vitest and the core-cli esbuild build all
  use. Web and core-cli therefore never need core to be built first.
- **Core API.** `applyCommand` (and `execute`, `undo`, `redo` on top of it) is the only way
  to change a document. Functions return a `Result` and do not throw for bad input. Types
  are inferred from the Zod schemas in `document/schema.ts` and `commands/schema.ts`; do not
  write them a second time.
- **Catalog.** Items are checked against a `Catalog` (`catalog/`, seed data in
  `SEED_CATALOG`) only when the caller passes one: `applyCommand(doc, cmd, { catalog })`.
  Corner cabinets go on the wall that starts at the corner, at offset 0, so the corner is
  at the item's left end. `generateParts` returns boxes local to the item: x along the
  width, y up, z from the back.
- **Catalog data.** The catalog is versioned data, not code. `CatalogSchema` (`catalog/schema.ts`)
  is the shape; `validateCatalog` and `parseCatalog` (`catalogData/`) are every rule a catalog
  must satisfy to be published, with a `{ path, message }` for each. Ids that code looks up
  (`REQUIRED_CATALOG_IDS`) must exist and not be retired, and an option key may only be used
  by the kinds whose `generateParts` reads it (`OPTION_KINDS`): add to those lists when
  code starts to depend on a new id or key. `retired` (entries and finishes) keeps a thing
  valid in existing documents but hides it from the palette and the assistant and makes
  `item.add` refuse it; nothing is ever hard-deleted. `SEED_CATALOG` is the compiled
  fallback and the first published version (`catalog.seed.json`, written by `schema`).
- **Catalog storage.** `CatalogVersion` (`controlpanel/models.py`) holds a draft (at most
  one, saved with a revision check) and published rows, which never change or get deleted:
  a stored quote names the `catalog_version` it was priced with and the server checks its
  lines against that version (`quotes/math.py:unit_price_cents` is a port of
  `entryUnitPriceCents`, tested with `test-vectors/quote.json`). The current catalog is the
  published row with the greatest number; rollback publishes a copy as a new one.
  `GET /api/catalog/` is public and cacheable, `/api/catalog/{version}/` is immutable.
  Publishing needs `config.catalog.publish` and runs every rule through
  `ezd-core validate-catalog`; editing the draft needs `config.catalog.edit`. Every
  `ezd-core` command that checks against a catalog takes it on stdin (`catalog` key) or as
  `--catalog <file>`, and uses the seed without one. The chat tools and index are made per
  catalog version by `ezd-core llm-tools` (`llm/prompt.py:assistant_for`); the committed
  `llm-tools.schema.json` and `llm-catalog-index.txt` are the seed snapshot. The web app
  reads the published catalog through `CatalogProvider` / `useCatalog()` and passes it to
  `createDesignStore`.
- **Rules.** `validate(doc, catalog)` returns every `Violation`, sorted;
  `validateCommand` applies a command and also returns the violations it `introduced`.
  Each rule is one file in `rules/rules/`, built with `defineRule` and registered in
  `rules/rules/index.ts`; its thresholds are named constants in `rules/constants.ts`. A
  rule never blocks a command: callers decide what to do with errors. Messages name items
  as `Base cabinet 30" at 12" on wall A`, walls being A, B, C in document order.
- **Rules config.** `RulesConfigSchema` (`rules/config.ts`) is the Control Panel's setting of
  the rules: `{ enabled, severity }` per rule id, nine `thresholds` (each a `Len` kept inside
  `THRESHOLD_RANGES`, so a value cannot make its rule a no-op) and the `snap` options. Unset
  means `DEFAULT_RULES_CONFIG`, built from `rules/constants.ts` and `DEFAULT_SNAP_OPTIONS`, so
  the output is what it was before. `validate`, `validateCommand`, `snap`, `dryRunProposal`
  (`options.rules`) and `createContext` take it as an optional last argument; a rule reads its
  thresholds from `ctx.config.thresholds`, never from the constants, and `defineRule` applies
  the switch and the severity. The rules in `LOCKED_RULES` protect the document's integrity
  and stay on and at error: the strict `validateRulesConfig` refuses a config that changes
  one, and `defineRule` ignores such a config anyway. Add a threshold to the schema, to
  `RULE_THRESHOLDS` and to a boundary test; the doc generator reads those. `ezd-core validate`,
  `llm-summary` and `llm-dry-run` read `rules` from stdin (or `--rules <file>`), so the server
  checks as the browser does; `packages/core/test-vectors/rules-parity.json` is the shared
  fixture that core, the CLI, the web store and pytest all check.
- **Geometry.** Checks along one wall use integer intervals (`geometry/intervals.ts`).
  Oriented-rectangle tests (`geometry/rects.ts`) are for items on different walls and
  free-placed items. `EPS` is the only float tolerance, and touching is never overlap.
- **Snapping.** `snap` and `snapResize` are pure and return integer `Len` values. The
  pointer is the middle of the dragged item.
- **Scene.** `buildScene(doc, catalog)` (`scene/`) is the only source of 3D geometry: a
  floor polygon and boxes in world inches, with plan x as world x, plan y as world z and
  elevation as world y. `rotationY` is in degrees, counterclockwise seen from above, as
  Three.js turns a mesh. A box's `sourceId` is the wall, item or countertop to select.
- **Bill of materials and pricing.** `computeBom(doc, catalog)` and `computeQuote(lines,
settings)` (`bom/`) are the only pricing code; the browser runs them. Money is integer
  cents and rates are integer basis points; every division goes through `divideHalfUp`, once
  per step. A countertop quantity is hundredths of a square foot. The API's
  `quotes/math.py` is a port used only to check stored quotes, and both are tested against
  `packages/core/test-vectors/quote.json`: change the two together, and add a vector.
- **Web store.** `createDesignStore(doc)` (`apps/web/src/store/`) holds one design: the
  document, its history and violations, and the UI state (selection, tool, view, viewport,
  drag ghost). Its `execute`, `undo` and `redo` are the only places that replace `doc`,
  each with the document core returned; ESLint rejects an assignment to `doc` or a
  `setState` call anywhere else. Immer is for the UI state only. A loaded or imported
  design gets a new store. Components read it with `useDesign(selector)`.
- **Editor.** Each edit is one command, built by a pure function in `editor/edits.ts` or
  `editor/tools/` and passed to `execute`; several changes go in one `batch`. A drag keeps
  a ghost in the store's `drag`, updated on each pointer move with core's `snap` or
  `snapResize`, and `commitDrag` executes one command on the drop, or none.
- **Views.** The plan and the elevations draw from the document through pure model
  functions (`editor/plan/model.ts`, `editor/elevation/model.ts`), which the tests compare.
  The Konva layers do not listen for events: `CanvasHost` takes pointer and key input and
  the views hit-test in drawing units (sixteenths of an inch). `editor/viewport.ts` converts
  between those and screen pixels; an elevation's drawing x is the offset along the wall and
  its y is the elevation negated.
- **Lengths in the UI.** Show a length with `formatLength` and read one with `parseLength`
  (the `LengthField` control does both). Widths, heights and depths come from the catalog
  entry; core's own message is shown when it refuses a value.
- **Persistence.** The app talks to a `DesignRepository` (`apps/web/src/lib/repository.ts`).
  The `localStorage` implementation reads through `migrate`, guards every storage access,
  and autosaves 500 ms after the last change to the document. It serves `/`, the editor
  without an account. The server implementation (`lib/serverRepository.ts`) holds the
  draft revision that every save sends back.
- **Server autosave.** `startServerAutosave` (`lib/autosave.ts`) saves 2 s after the last
  command with one request in flight at a time. Its status is `saved`, `saving`,
  `offline` (retried with backoff, with a backup in `localStorage`), `conflict` (stopped
  until the user chooses) or `error`. A document replaced as a whole (loaded, imported,
  restored) gets a new store and a new autosave; start one from an effect or a handler,
  never from a state updater, which React may run twice.
- **Web API client.** `apps/web/src/api/client.ts` is the only caller of `fetch`. It sends
  the CSRF token, throws `ApiError` or `NetworkError`, and reports a 401 to the handler
  that leads to the login page. Its types come from `schema.d.ts`; do not write them by
  hand. Server state other than the open design goes through TanStack Query.
- **API.** Every view under `/api/` reads rows through `OwnedQuerysetMixin` and the
  models' `for_user`, so another account's object is a 404. A new route needs a name and
  an entry in `tests/test_isolation.py`, which fails otherwise. Unauthenticated is 401.
- **Stored documents.** Every write of a document goes through
  `projects.documents.validate_document`: known `schemaVersion`, the JSON Schema from
  core, `id` equal to the design id, then `ezd-core validate-document`. Failures are a 422
  with `errors: [{ path, message }]` and nothing is stored.
- **Quotes** are immutable. Creating one snapshots the draft as a new `DesignVersion`,
  only if the draft is still at the `draft_revision` the browser priced (409 otherwise),
  and the server rejects lines or totals that do not follow from each other (422). The PDF
  is rendered in the browser from the stored quote alone (`apps/web/src/quotes/`), with an
  embedded font and the quote's own dates, so the same quote gives the same bytes. Its
  drawings are RGB PNGs with no alpha channel (`editor/png.ts`): a PDF embeds an alpha
  channel asynchronously, which reorders the file. The server refuses any other PNG.
  Branding (company, prefix, footer, logo) is copied into `Quote.branding` by the server from
  the published quote defaults at creation, never from the request, and the PDF reads only the
  stored copy, so a later change to the defaults leaves old quotes and their PDFs as they were.
- **Body size.** A request body over 2 MB is a 413. A view that needs more sets
  `max_body_bytes`, up to `DATA_UPLOAD_MAX_MEMORY_SIZE`, which is the most Django reads.
- **Autosave on the server** is one `UPDATE ... WHERE id = ? AND draft_revision = ?` on
  the design's own columns. Do not add a join to that filter: Django would move the
  comparison into a subquery and two concurrent saves could both succeed.
- **Chat assistant.** The model never changes the document. Core's `llm/` writes what it
  reads (`summarizeForLLM`, `catalogIndexForLLM`, the tool schemas in inches) and turns its
  tool calls into one `batch` (`proposalToCommands`); `dryRunProposal` is the check the
  browser and the eval runner both run. A proposal that does not convert or introduces an
  error-severity violation is sent back for a retry (two at most, the last on the
  escalation model) and never shown. The browser keeps a valid one in the store's
  `proposal`, the views draw it as ghosts (`editor/preview.ts`), and Accept executes it as
  one command; any other change to the document cancels it.
- **LLM vendors.** Everything outside a vendor module (`llm/openai_client.py`) talks to
  the `LLMClient` protocol in `llm/client.py`. `LLM_VENDOR` picks the client
  (`openai`, or `fake` for tests); model names are settings. Staff enter the API key on the
  AI settings page (`/settings/ai`, `PATCH /api/llm/settings/`): it is stored encrypted
  (`llm/secrets.py`), wins over `LLM_API_KEY`, and is never sent back or logged.
  `chat.services.run_attempt` is the one code path for a model call, used by the chat
  endpoints and by `run_evals`.
- **Evals.** A case in `evals/cases.json` is `{ name, document, message, expect }`, with
  lengths in inches; assertion types are in `chat/evals.py`. `--client fake` replays
  `evals/recordings/fake/<case>.json` (scripted to exercise the pipeline; CI requires 100
  percent). `--client live --record` calls the vendor and saves real responses. Reports go
  to `evals/reports/` (not committed). The `Evals (live)` workflow runs it by hand with the
  `LLM_API_KEY` secret.
- **Deployment.** Railway builds `main` into two services from the repository root, each
  with its own `railway.json`: `api` (`apps/api/Dockerfile`, private, port 8000, with
  `config.settings.prod`) and `web` (`apps/web/Dockerfile`: Caddy serves the build and proxies
  `/api` to `API_UPSTREAM`, so the browser sees one origin). Django sits behind the host's
  edge and Caddy, so `DJANGO_NUM_PROXIES=2`, and Caddy tells it the request was https.
- **Photo import.** The vision model only recognises the layout; the user supplies every
  real dimension. Core's `photo/` has two schemas: `DraftRoom`, the model's answer in inches
  (strict structured output, exported as `draft-room.schema.json`), and `RoomDraft`, the
  stored and edited draft in `Len` (`room-draft.schema.json`), where each length is
  `{ value, estimated }`. `normalizeDraft` (run on the server through `ezd-core
normalize-draft`) snaps cabinets to the catalog and marks every model length as an
  estimate; `draftProblems` lists what blocks confirmation, an estimated wall length
  included; `draftToCommands` builds the design as one `batch`. `photos.analysis.analyze`
  is the one code path for a photo call, used by the analyze endpoint and
  `run_photo_evals`: an answer that fails the schema is retried on the same model, then on
  the escalation model, then the draft is `failed`. Confirm runs `ezd-core draft-problems`
  on the stored draft, whatever the browser sends, and creates the design and version 1
  in one transaction, once. Uploads are decoded and re-encoded with Pillow
  (`photos/images.py`): type from content, EXIF orientation applied, metadata stripped,
  long edge at most `PHOTO_MAX_EDGE`, pixel count capped. Photos are stored through
  Django's storage (`STORAGE_BACKEND`: `filesystem` or a private `s3` bucket) and served
  only by `/api/photos/{id}/file/` to their owner.
- **Photo test set.** `evals/photos/` holds each photo with its ground truth (`<name>.json`),
  its source and right in `SOURCES.md`, and a recorded fake answer under
  `recordings/fake/`. CI requires every recorded answer to convert.
- **Relative imports in `packages/core` and `packages/core-cli`** carry a `.js` extension
  (`./units.js`), so the emitted ESM runs in Node unchanged.
- **Control Panel.** `/admin` in the web app is for staff (`is_staff`), and each section needs
  a permission code (`controlpanel/codes.py`: `users.view`, `audit.view`, ...), held through the
  seeded groups Administrator, Catalog editor and Support; a superuser holds them all. A view
  declares its code with `HasControlPanelPerm` and `control_panel_perm` (a code, or a dict from
  method to code); the server enforces it, and `useCan` / `RequirePermission` only hide things.
  Every admin mutation calls `controlpanel.audit.record`, which redacts secret-looking keys.
  `controlpanel/guards.py` keeps the last active superuser and stops anyone from locking
  themselves out, in the API and in the Django `UserAdmin`. The e2e API starts with an
  administrator and a support user (`apps/api/tests/fixtures/staff.json`, password as
  `PASSWORD` in `e2e/helpers.ts`); their password hash needs a full-length salt, or Django
  rehashes it on login and ends the sessions of parallel logins.
- **App config.** `AppConfigSchema` (`packages/core/src/config/`) is the Control Panel's
  configuration: panels, features, toolbar, viewport, theme and help text. Every field is
  optional and has a default equal to the app's behavior before configuration existed
  (`DEFAULT_APP_CONFIG`). `validateAppConfig` is strict (the server and the settings form use
  it); `parseAppConfig` never refuses an object and drops what is not valid field by field
  (the browser uses it on what it received). The API stores versions in `ConfigVersion`
  (at most one draft and one published; a published row never changes; rollback publishes a
  copy as a new number), validates through `ezd-core validate-config`, and serves the
  published one at `GET /api/config/` with no session, adding whether the assistant is
  effectively on (its flag and a configured key). `ConfigProvider` fetches it once, keeps a
  copy in `localStorage` and falls back to the defaults; read it with `useConfig()`. A flag
  that is off removes its UI and its keyboard shortcut, never a document's content. The colors
  and viewport limits are applied to `editor/style.ts` and `editor/viewport.ts` before an
  editor opens. The e2e `config` project runs after the others, because publishing changes
  every editor.
- **Rules and quote defaults** are two more sections of the same `ConfigVersion`
  (`rules_config`, `quote_defaults`), published together with `app_config`, so one version
  number names a whole configuration and a rollback restores all three. Each is edited with its
  own permission (`config.app.edit`, `config.rules.edit`, `config.quote.edit`): the draft
  `PUT` takes any of the three sections and needs the code of each one it carries, and a publish
  or rollback is refused if it changes a section the user may not edit. `QuoteDefaultsSchema`
  (`bom/defaults.ts`) holds the default rates and `branding`; a logo is a JPEG or an RGB PNG as
  a data URI under 150 KB, checked again by the server. `GET /api/config/` serves `rules_config`
  and `quote_defaults` (without the logo, which the browser never needs). The web reads them
  with `useRulesConfig()` and `useQuoteDefaults()`, passes the rules to `createDesignStore`,
  and `QuoteForm` starts from the rates. The e2e `rules` project runs after `config`, since both
  publish. To run e2e on another port (5173 busy), set `E2E_PORT` and
  `DJANGO_CSRF_TRUSTED_ORIGINS=http://localhost:<port>`.
- **Django settings** are `config.settings.dev` (default for `manage.py`),
  `config.settings.test` (pytest) and `config.settings.prod` (default for WSGI/ASGI). All
  read environment variables; every variable is listed in `apps/api/.env.example`.
- **User model.** `AUTH_USER_MODEL` is `accounts.User`, which logs in by email and has no
  username. Always use `get_user_model()` or `settings.AUTH_USER_MODEL`.
- **Sessions.** Authentication is Django's session cookie with CSRF on every unsafe
  method, including the anonymous ones (login, register, password reset). There are no
  tokens in JavaScript.
- **Migrations** are generated by Django and are excluded from Ruff and Prettier.

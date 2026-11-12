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
  apps/web/           @ezd/web       React + Vite app
  apps/api/           Django project (Python)
  evals/              LLM eval cases and recorded fixtures (added in a later phase)
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

- JSON Schema: `pnpm --filter @ezd/core schema` rewrites `packages/core/schema/*.json` from
  the Zod schemas. Run it and commit the result whenever a document or command schema
  changes; CI fails if the committed files are stale.
- Core tests run with coverage and fail below 95 percent of lines or branches.
- Core performance tests are the `*.perf.test.ts` files. `pnpm --filter @ezd/core test` runs
  them in a second pass (`vitest.perf.config.ts`) without coverage, which would distort the
  timings.
- Web dev server: `pnpm --filter @ezd/web dev` (http://localhost:5173, proxies `/api` to
  http://localhost:8000).
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

There is no Python typecheck or build step yet. pytest needs PostgreSQL running.

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
- **Rules.** `validate(doc, catalog)` returns every `Violation`, sorted;
  `validateCommand` applies a command and also returns the violations it `introduced`.
  Each rule is one file in `rules/rules/`, built with `defineRule` and registered in
  `rules/rules/index.ts`; its thresholds are named constants in `rules/constants.ts`. A
  rule never blocks a command: callers decide what to do with errors. Messages name items
  as `Base cabinet 30" at 12" on wall A`, walls being A, B, C in document order.
- **Geometry.** Checks along one wall use integer intervals (`geometry/intervals.ts`).
  Oriented-rectangle tests (`geometry/rects.ts`) are for items on different walls and
  free-placed items. `EPS` is the only float tolerance, and touching is never overlap.
- **Snapping.** `snap` and `snapResize` are pure and return integer `Len` values. The
  pointer is the middle of the dragged item.
- **Relative imports in `packages/core` and `packages/core-cli`** carry a `.js` extension
  (`./units.js`), so the emitted ESM runs in Node unchanged.
- **Django settings** are `config.settings.dev` (default for `manage.py`),
  `config.settings.test` (pytest) and `config.settings.prod` (default for WSGI/ASGI). All
  read environment variables; every variable is listed in `apps/api/.env.example`.
- **User model.** `AUTH_USER_MODEL` is `accounts.User`, which logs in by email and has no
  username. Always use `get_user_model()` or `settings.AUTH_USER_MODEL`.
- **Migrations** are generated by Django and are excluded from Ruff and Prettier.

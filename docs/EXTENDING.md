# Extending EZDesign

v1 left these out on purpose and was built so they can be added. Each section names the
interfaces in the code to implement or change. Paths are from the repository root; core's
are under `packages/core/src/`.

## Real-time collaboration

**What is already there.** Every change is a serialisable `Command` (`commands/schema.ts`)
that carries the ids of what it adds, so replaying a log of commands gives the same
document on every machine. `applyCommand(doc, command, ctx)` (`commands/apply.ts`) returns
`{ doc, inverse }`, and the editor's history (`history/index.ts`) is a list of
`Entry = { command, inverse }` that `execute`, `undo` and `redo` walk. Nothing mutates a
document in place.

**Today** the browser saves the whole document (`PUT /api/designs/{id}/draft/`, with
`base_revision` for optimistic concurrency) and a conflict asks the user to choose
(`apps/web/src/lib/autosave.ts`).

**An ordered command log on the server** is the smaller step:

1. A `DesignCommand(design, seq, command, author, created_at)` table and
   `POST /api/designs/{id}/commands/` taking `{ base_seq, commands }`. The server applies
   them with `ezd-core validate` (`packages/core-cli`, which already applies a batch) and
   stores them only if `base_seq` is the latest; otherwise it answers with the commands
   since `base_seq`.
2. The client rebases: undo its unsent commands with their inverses, apply the server's,
   re-apply its own with `applyCommand`, and drop any that no longer apply (core's error
   says why).
3. Clients follow the log over Server-Sent Events or a WebSocket.

In `history/`, `undo` must then only undo the user's own commands: keep `Entry` per author,
and recompute an inverse with `applyCommand` against the current document when an undone
command was rebased.

**A CRDT** (for example Yjs, MIT) replaces the log: map the document's arrays (walls,
openings, items, countertops) to CRDT maps keyed by id, and keep commands as the only way to
write to them, so validation stays in core. Rules and `validate` run on the merged
document, unchanged.

## Manufacturer catalogs

**The interface** is `CatalogProvider` (`catalog/provider.ts`):

```ts
interface CatalogProvider {
  readonly id: string;
  load(): Promise<Result<Catalog, string>>;
}
```

`Catalog` (`catalog/types.ts`) is `{ version, entries: CatalogEntry[], finishes: Finish[] }`.
A `CatalogEntry` declares its widths (`{ min, max, step }`, a list of `values`, or `free`
for fillers), its standard `heights` and `depths`, its options, where it can be placed, and
its price (`baseCents`, `perInchWidthCents`, `optionCents`). `checkItemAgainstCatalog`
(`catalog/constraints.ts`) enforces all of it, and `generateParts` (`catalog/parts.ts`)
builds the boxes the elevation and the BOM use. `firstAvailable([vendor, seedCatalogProvider])`
falls back to the seed catalog.

- **Versioning.** Bump `version` whenever entries, sizes or prices change. A quote stores
  the `catalog_version` it was priced with and never changes; the API refuses a quote
  whose lines do not add up.
- **Prices and constraints** come only from the provider: pricing (`bom/`) and rules read
  the `Catalog` they are given.
- **Licensing.** Do not copy a manufacturer's catalog, part numbers, prices, images or
  file formats into this repository. A provider loads data the user's organisation is
  licensed to use, at run time, from that organisation's own source.

## Bath and closet modules

- **New item kinds.** Add to `ItemKindSchema` (`document/schema.ts`), with a schema
  version bump and a migration (`document/migrate.ts`; add a frozen fixture under
  `document/fixtures/v<N>/`).
- **New catalog entries** (vanities, linen towers, closet shelving) through a
  `CatalogProvider`, with `generateParts` for their boxes.
- **New rules** in `rules/rules/`, each built with `defineRule(id, severity, find)` and
  registered in `rules/rules/index.ts`; thresholds in `rules/constants.ts`.
  `pnpm --filter @ezd/core schema` regenerates `docs/RULES.md`.
- **What stays shared:** the room (walls, openings, ceiling), commands, history, snapping,
  the plan and elevation views, BOM and quotes, accounts, autosave and versions.

## Other LLM vendors

Implement the `LLMClient` protocol (`apps/api/llm/client.py`):

```python
class LLMClient(Protocol):
    def propose(self, request: ProposeRequest) -> ProposeResponse: ...
    def analyze_photo(self, request: PhotoRequest) -> PhotoResponse: ...
```

in one module (as `llm/openai_client.py` does), raising `LLMUnavailable` with a message the
user can read for every vendor error. Register it in `LLM_CLIENTS` (`config/settings/base.py`)
and select it with `LLM_VENDOR`. Map `tool_choice`, the tools' JSON Schema and strict
structured output (`PhotoRequest.schema`) to the vendor's equivalents, and put
`system`, the tools and the catalog index first so the vendor can cache them.

Then run both eval suites against it, with the models you want to compare:

```sh
uv run python manage.py run_evals --client live --vendor <name> --record
uv run python manage.py run_photo_evals --client live --vendor <name> --model <vision> --record
```

and compare accuracy, valid-proposal rate, retries, schema-valid rate, shape accuracy and
cost per accepted edit or per photo.

## Server-side rendering of images

Drawings are rendered in the browser today: `apps/web/src/editor/capture.tsx` draws the
plan and elevations off screen, `editor/png.ts` encodes them, and the quote stores them.
Both views draw from pure model functions (`apps/web/src/editor/plan/model.ts`,
`editor/elevation/model.ts`) that take only a document and a catalog.

A server renderer would run those model functions in Node with a canvas implementation
(for example `skia-canvas`, MIT) behind a new `ezd-core render` command, called by the API
like `ezd-core validate`. Photo-real rendering would instead start from `buildScene`
(below) and a ray tracer, in a worker service.

## 3D view

`buildScene(doc, catalog)` (`scene/scene.ts`) returns `SceneNode[]`: one floor polygon and
boxes in world inches, with plan x as world x, plan y as world z and elevation as world y.
Each `SceneBox` has its `size`, the `position` of its centre, `rotationY` in degrees
(counter-clockwise seen from above, as Three.js turns a mesh), its resolved `finish` id (the
colour is the catalog finish's `color`), a `role`, and the `sourceId` of the wall, item or
countertop it belongs to.

A renderer (for example `react-three-fiber`, MIT) maps each box to a mesh, puts the floor
polygon on y = 0, and selects `sourceId` in the store on click. It reads the document
through `useDesign` and never writes to it: a drag in 3D goes through core's `snap` and
`execute`, like the plan.

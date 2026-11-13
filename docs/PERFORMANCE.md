# Performance

The targets come from #12. Every number below was measured, on the machine and date given,
with the command next to it. Re-run them after a change that could affect speed, and update
this page.

Measured on 2026-11-13 on a laptop with an Apple A18 Pro and 8 GB of memory (macOS 26.5),
Node 24, Chromium from Playwright 1.65.

| Area                                            | Target                       | Measured                         | How                                          |
| ----------------------------------------------- | ---------------------------- | -------------------------------- | -------------------------------------------- |
| `validate` on a 200-item design                 | under 10 ms                  | 0.77 ms                          | core perf tests (1)                          |
| `snap` per pointer move, 200 items              | under 4 ms                   | 1.95 ms                          | core perf tests (1)                          |
| `validate` / `snap`, 500 items                  | none (guard: twice the 200s) | 2.17 ms / 5.07 ms                | core perf tests (1)                          |
| Plan view drag with 200 items                   | 60 fps                       | 60.0 fps mean, p95 frame 16.8 ms | browser perf tests (2)                       |
| Initial JS and CSS for the editor, gzipped      | under 350 kB                 | 302.8 kB                         | `pnpm --filter @ezd/web bundle-size` (3)     |
| Editor interactive on a cold load, fast 4G      | under 3 s                    | 0.54 s                           | browser perf tests (2)                       |
| Autosave of a 200-item design, server time, p95 | under 300 ms                 | 172 ms (median 118 ms)           | `uv run pytest tests/test_performance.py -s` |

1. `pnpm --filter @ezd/core test` runs `src/rules/performance.perf.test.ts` without coverage
   in its second pass, and fails above the targets. The timings print with
   `pnpm --filter @ezd/core exec vitest run --config vitest.perf.config.ts --silent=false`.
2. `pnpm --filter @ezd/web perf` builds the web app, serves it with `vite preview` and runs
   `apps/web/perf/editor.perf.ts`: a 120-step drag from the catalog across a plan holding the
   200-item fixture, counting animation frames, and a cold load with the cache disabled
   under Chrome DevTools' Fast 4G profile (9 Mbit/s down, 1.5 Mbit/s up, 60 ms latency).
   The load time is from navigation until the toolbar and the canvas are usable. It runs
   against a local server, so it measures transfer and start-up, not a real network's
   jitter. It is not in CI: shared runners make frame timings noisy.
3. CI fails the `js` job above the budget (`apps/web/scripts/check-bundle.mjs`). The PDF
   renderer, the largest dependency, is a separate chunk loaded only when a quote is
   downloaded.

## Fixtures

`packages/core/src/document/fixtures/kitchen-200.json` and `kitchen-500.json` are generated
by `largeKitchen` (`packages/core/src/test/large.ts`): base and wall cabinets round every
wall, then rows of islands. `pnpm --filter @ezd/core schema` rewrites them, and CI fails if
the committed files are stale.

## What was changed

- The plan's layers that draw only from the document (floor, walls, openings, countertops,
  items, dimensions, grid) are memoised. During a drag only the ghost and guides change, so
  the 200 items are no longer drawn again on every pointer move. The drag went from 59.1 to
  60.0 fps mean on the machine above; on a slower machine the saving is larger.
- Every `useDesign` selector reads one field of the store, so a component renders again
  only when that field changes. None returns a new object or array per call.
- Every list endpoint reads its rows in a fixed number of queries, whatever the number of
  rows (`apps/api/tests/test_lists.py`), and is paged: `?limit=` (100 by default, 500 at
  most) and `?offset=`, with `X-Total-Count` and a `Link` header. A list is still a JSON
  array, so clients that read the first page need no change.

## Not met, or not measured

Every target above is met. The drag and load figures come from one machine; the issue's
"mid-range laptop" is not pinned down further, and no figure was taken on a slower one.

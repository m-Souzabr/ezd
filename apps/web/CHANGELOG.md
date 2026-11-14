# Design system changelog

## Changes to components/ui

- None yet. `button.tsx` is as the shadcn CLI wrote it (Base UI, Nova), only reformatted by Prettier.

## Spec deviations

- **Prettier.** The build spec's settings (no semicolons, double quotes) are not adopted; the repository's `.prettierrc` applies, so generated and written files use single quotes and semicolons.
- **axe.** `@axe-core/playwright` is not added: axe-core is MPL-2.0, which `licenses.allow.json` rules out. The in-house `audit()` in `e2e/a11y.ts` is extended instead.
- **Alias.** `@/` is `apps/web/src`, set in `tsconfig.json` and `vite.config.ts` (Vitest and `vite.csp.config.ts` read it). There is no `tsconfig.app.json` and no new package.
- **Dependency catalog.** Every dependency the CLI or the spec adds has its version in the `catalog` of `pnpm-workspace.yaml` and is `"catalog:"` in `package.json`. `@fontsource-variable/geist`, which the CLI added, is not kept (OFL-1.1).
- **Test setup.** The `matchMedia` mock is in the existing `src/test-setup.ts`, not a new `src/test/setup.ts`. Tests import `describe`, `it` and `expect` from `vitest`, since `globals` is off.
- **Base layer.** The shadcn base rules (`* { border-border }`, body background and text color, `font-sans` on `html` and `body`) are left out of `globals.css`, so the screens that still use fixed slate classes look as before. The spec's `pb-safe` utilities, coarse-pointer 44 px targets and reduced-motion rules are in. `--default-font-family` is also pinned to Tailwind's system stack, since preflight would follow `--font-sans`. Phase 18 adds the base rules back and drops the pin when the screens move to tokens.
- **Font.** Inter Variable (`@fontsource-variable/inter`) is OFL-1.1, which `licenses.allow.json` does not allow, and the owner has not approved an exception (see #39). Until then `--font-sans` is Roboto (`roboto-fontface`, Apache-2.0), which the quote PDF also embeds. Switching to Inter later is the font import and `--font-sans` in `globals.css`, plus the exception.
- **Dark mode.** `ThemeProvider` is mounted, but the toggle is not shown, and `index.html` has no `color-scheme` meta or pre-paint script yet (Phase 21).

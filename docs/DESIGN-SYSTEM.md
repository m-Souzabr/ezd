# Design system guide

How the web app (`apps/web`) is styled and how to build a screen so it matches. The live gallery
is at `/design-system` in a development or test build (`pnpm --filter @ezd/web dev`); it is not
in the production build or linked from the navigation. The changelog of edits to generated
components and of deviations from the original spec is `apps/web/CHANGELOG.md`.

## Where things live

- `src/styles/globals.css`: every token (color, radius, font). Change them here and nowhere else.
- `src/components/ui`: shadcn/ui components on Base UI, written by the shadcn CLI. Not hand-edited
  except as `CHANGELOG.md` records.
- `src/components/patterns`: exactly nine files: `app-shell`, `confirm-dialog`, `data-list`,
  `form-section`, `page-header`, `responsive-dialog`, `responsive-menu`, `state-views`,
  `theme-toggle`. Their tests are in `src/test/patterns/`.
- Screens and feature components: `src/pages`, `src/admin`, `src/editor`, `src/quotes`, `src/photos`.
- `/design-system` (`src/routes/design-system.tsx`): tokens, components and patterns on one page.

## Rules

1. Colors, radius and shadows come from tokens (`bg-primary`, `text-muted-foreground`, ...). A raw
   color class (`bg-slate-100`) or a hex value fails `pnpm lint` anywhere in `src`, except in
   `components/ui`, tests and the canvas files (`editor/style.ts`, `draw.tsx`, `CanvasHost.tsx`,
   `capture.tsx`, `editor/plan`, `editor/elevation`), each commented in `eslint.config.js`. The quote PDF
   (`quotes/QuotePdf.tsx`) uses fixed ink colors: it is a printed page, whatever the theme.
2. Variants are defined with `cva` in the component file; do not restyle from outside.
3. Import patterns first, `components/ui` second, never the primitive library (`@base-ui/react`).
4. Switch layouts with `md:` and `lg:` classes. `useMediaQuery` is for patterns only.
5. Status is never shown by color alone: a `Badge` has text, an error has words.
6. A control on a touch screen is at least 44 px (`globals.css` enforces it for buttons, links,
   selects and tabs under `pointer: coarse`; a custom control needs `pointer-coarse:h-11`).
7. Lengths use `formatLength` and `LengthField`; money is integer cents shown in dollars.

## Building a screen

1. Make the page component and add its route in `src/App.tsx`. A Control Panel section also goes
   in `src/admin/sections.ts` (label, icon, description, permission).
2. Top-level account screens get a `NavItem` in `AccountShell` (at most five on a phone).
3. Start with `PageHeader`. Lists are a `DataList` (cards under 768 px, a table above);
   forms use `FormSection`, `TextField` and `FormActions`.
4. Create and edit flows open in `ResponsiveDialog`; anything destructive goes through
   `ConfirmDialog`.
5. Show loading, empty and failure with `LoadingState`, `EmptyState` and `ErrorState`.
6. Add the route to `design-system.spec.ts` (a signed-in page or an admin section) and run it:
   it audits the page in light and dark at 375, 768 and 1280 px.

## Adding a shadcn/ui component

1. `pnpm --filter @ezd/web exec shadcn add <name>`; commit the generated file.
2. Show it, in each state, on `/design-system`.
3. List any edit you make to it in `apps/web/CHANGELOG.md`.

## Dark mode

`ThemeProvider` keeps the choice (`light`, `dark` or `system`) in `localStorage` under
`app-theme` and toggles the `dark` class on `<html>`. `public/theme-init.js`, a same-origin
file so the Content-Security-Policy stays `script-src 'self'`, applies it before the first
paint. `ThemeToggle` is in the app shell, the Control Panel header and the editor header. The
editor's drawing sheet stays light in a dark theme (its colors come from the Control Panel's
theme, `editor/style.ts`); dark canvas colors are a follow-up.

## Changing the brand color

Edit `--primary`, `--ring`, `--sidebar-primary` and `--sidebar-ring` in `:root` and `.dark` in
`globals.css`, then run the design-system spec (`pnpm --filter @ezd/web exec playwright test
design-system`). If a token fails contrast, change only the lightness of that token's background
by 0.02 and repeat until it passes; record the new value in `CHANGELOG.md`. The gallery is only
in a development build, so run the spec against `pnpm --filter @ezd/web dev`, which Playwright
starts itself.

## Checks

`pnpm lint` (raw colors), `pnpm --filter @ezd/web e2e` (the audit in `e2e/a11y.ts`: names, labels,
dialogs, contrast, 44 px targets, visible focus) and `pnpm --filter @ezd/web bundle-size`
(350 kB gzipped). axe-core is not used: it is MPL-2.0, which the license allowlist rules out.

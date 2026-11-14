# Design system changelog

## Changes to components/ui

- button: added sizes `touch` and `icon-touch`.
- badge: added variants `success`, `warning` and `info`.
- Every other file in `components/ui` is as the shadcn CLI wrote it (Base UI, Nova), only reformatted by Prettier. `input.tsx` and `textarea.tsx` already have `text-base md:text-sm`. `hooks/use-mobile.ts` was added by the CLI for `sidebar.tsx` (see Spec deviations).

## Spec deviations

- **Prettier.** The build spec's settings (no semicolons, double quotes) are not adopted; the repository's `.prettierrc` applies, so generated and written files use single quotes and semicolons.
- **axe.** `@axe-core/playwright` is not added: axe-core is MPL-2.0, which `licenses.allow.json` rules out. The in-house `audit()` in `e2e/a11y.ts` is extended instead.
- **Alias.** `@/` is `apps/web/src`, set in `tsconfig.json` and `vite.config.ts` (Vitest and `vite.csp.config.ts` read it). There is no `tsconfig.app.json` and no new package.
- **Dependency catalog.** Every dependency the CLI or the spec adds has its version in the `catalog` of `pnpm-workspace.yaml` and is `"catalog:"` in `package.json`. `@fontsource-variable/geist`, which the CLI added, is not kept (OFL-1.1).
- **Test setup.** The `matchMedia` mock is in the existing `src/test-setup.ts`, not a new `src/test/setup.ts`. Tests import `describe`, `it` and `expect` from `vitest`, since `globals` is off.
- **Base layer.** Phase 18 turns the shadcn base rules on in `globals.css` (`* { border-border outline-ring/50 }`, body background and text color, `font-sans` on `html` and `body`) and drops the `--default-font-family` pin, as Phase 16 planned. The spec's `pb-safe` utilities, coarse-pointer 44 px targets and reduced-motion rules were already in.
- **Font.** Inter Variable (`@fontsource-variable/inter`) is OFL-1.1, which `licenses.allow.json` does not allow, and the owner has not approved an exception (see #39). Until then `--font-sans` is Roboto (`roboto-fontface`, Apache-2.0), which the quote PDF also embeds. Switching to Inter later is the font import and `--font-sans` in `globals.css`, plus the exception.
- **Dark mode.** `ThemeProvider` is mounted, but the toggle is not shown, and `index.html` has no `color-scheme` meta or pre-paint script yet (Phase 21).
- **Pattern files.** Their tests are in `src/test/patterns/`, so `components/patterns` holds only the nine pattern files. `lib/navigation.ts` has no `NAV_ITEMS`: `AppShell` takes its `items` (a `NavItem` may carry `permission` or `staffOnly`), and the bottom bar shows at most five. `AppShell` has an `appName` prop (default `EZDesign`) instead of `lib/app-config`, and renders the signed-in account (email, sign out) or the sign-in links in the sidebar footer; a phone gets them in the header.
- **`useSignOut`.** Moved from `pages/ui.tsx` to `auth/useSignOut.ts` so `AppShell` can use it; the behavior is the same.
- **`SidebarInset` is a `main`.** The generated `SidebarInset` renders `<main>`, so the shell's content wrapper is `<div id="main" tabIndex={-1}>` (the skip link's target), not a second `main`.
- **`ConfirmDialog`.** Base UI's `AlertDialogAction` does not close the dialog (Radix's did), so the confirm button calls `onConfirm` and then `onOpenChange(false)`.
- **`DataList`.** Adds a controlled `sort` (`{ id, descending }`), `onSortChange` and a per-column `sortable`; sortable headers are buttons with `aria-sort`, and the cards print the active sort as text.
- **`TextField`.** Also forwards `inputMode` and `required`.
- **Gallery.** `/design-system` (`routes/design-system.tsx`) exists only when `import.meta.env.DEV` or `MODE === 'test'`, is loaded with `lazy`, and is not linked from the navigation. It adds a section per pattern to the spec's six. It sits outside the shell and has the theme toggle in its header.
- **`useIsMobile`.** The CLI's `hooks/use-mobile.ts` sets state inside an effect, which the repository's `react-hooks/set-state-in-effect` rule rejects. It keeps its name and its 768 px breakpoint but reads `useMediaQuery` (the same `useSyncExternalStore` the patterns use). It is a hook, not a `components/ui` file.

## Phase 18 (account pages)

- **New files.** `components/ui/native-select.tsx` (shadcn's native select, for the draft editor's pickers, which a phone shows with its own picker), `components/form-error.tsx` (a failed request said once, in a `FieldError`; not a tenth pattern), `lib/formErrors.ts` (`applyServerErrors` puts an `ApiError`'s field messages under their fields), `pages/AuthLayout.tsx`, `pages/AccountShell.tsx` (the shell with the app's navigation items), `pages/NameDialog.tsx` (create and rename in a `ResponsiveDialog`) and `CrashPage.tsx`.
- **Pattern changes.** `AppShell` has a `themeToggle` prop (the account pages pass `false` until Phase 21), `FormSection` has `columns` (`one` or `two`), `FormActions` has `aboveTabBar` (the sticky bar clears the bottom tab bar and the safe area) and `ErrorState` takes `retryLabel` and extra actions as children.
- **Lazy loading.** The shell, the account pages and the sign-in pages are loaded when visited, and so are the error page and the photo reference panel, which keeps the initial bundle under 350 kB.
- **Still shared with Phases 19 and 20.** `pages/ui.tsx` (`Page`, `TextField`, `FormError`, `ConfirmButton`, `AccountLinks`, `PRIMARY`, `LINK`), `pages/Table.tsx`, `pages/sort.ts` and `pages/Modal.tsx` stay: the Control Panel, the editor pages and the local editor still import them. `InlineCreate` and `RenameButton` were only used by the projects page and are deleted. `Table` has server-side sort, loading and error states that `DataList` does not, so the Control Panel keeps it and its tests.
- **e2e.** Creating a project or a design is now a dialog (`New project` button, `Project name` field, `Create project`), so the specs use `createProjectInUi` and `createDesignInUi` from `e2e/helpers.ts` instead of the inline form's locators. The `phone`, `tablet` and `desktop` projects run `e2e/account-layout.spec.ts` only.
- **Quote page.** Delete asks for confirmation (it did not before). The `Final` badge is there because a stored quote never changes.

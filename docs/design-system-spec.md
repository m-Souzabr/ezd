# Design system: plan and build spec

Source documents for the design system epic [#39](https://github.com/m-Souzabr/ezd/issues/39)
(phases #40 to #45), kept here so the phase issues can point at step numbers.

- Part 1 is the plan: tokens, components, responsive rules and phases.
- Part 2 is the build spec for the coding agent: Steps 1 to 8 with the code.

The spec was written for a new project called `my-app`. This repository already has
`apps/web`, so the epic and the phase issues adapt it (see the adaptations table in #39).
Where the epic, a phase issue or [AGENTS.md](../AGENTS.md) differs from this file, they win.

This file is excluded from Prettier on purpose: its code samples use the spec's own style
(no semicolons, double quotes), which is not this repository's style. When you copy a block
into the codebase, format it with `pnpm format`.

The code blocks were written against the shadcn/ui docs of November 2026 and have not been
compiled.

---

# Part 1: App design system and implementation plan (shadcn/ui)

Nov 13, 2026

A neutral, brand-swappable design system for a responsive React app on shadcn/ui and Tailwind
CSS, with a six-phase plan to implement it across phone, tablet and desktop.

## At a glance

The system has four layers, and each one uses only the layer beneath it: screens, patterns,
shadcn/ui components, tokens. Screens never style anything directly: they compose patterns,
patterns compose shadcn/ui components, and components read tokens.

(The original page has a diagram here, and another in the implementation plan. They are not
reproduced.)

## Stack

The system runs on Vite, React, TypeScript, Tailwind CSS v4 and shadcn/ui, with every other
tool chosen to keep the bundle small. Swap Vite for Next.js only if you need server
rendering.

| Layer         | Choice                                    | Why                                                                      |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Build         | Vite + React + TypeScript                 | Fast dev server, no framework overhead.                                  |
| Styling       | Tailwind CSS v4                           | Tokens live in CSS (`@theme`), no config file to maintain.               |
| Components    | shadcn/ui via `shadcn@latest` CLI         | Code is copied into the repo, so you ship only what you use.             |
| Primitives    | Base UI (pick it at the init prompt)      | Current shadcn/ui docs and example config use the Base UI style; Radix is the other option. |
| Icons         | lucide-react                              | Tree-shakeable, one consistent stroke style.                             |
| Forms         | React Hook Form + Zod                     | Documented shadcn/ui integration through the Field component.            |
| Font          | Inter Variable, self-hosted               | One file covers every weight; no third-party request.                    |
| Tests         | Vitest, Testing Library, Playwright + axe | Unit, interaction, accessibility and screenshot checks.                  |
| Installable app | vite-plugin-pwa (optional)              | Home-screen install on phone and tablet without an app store.            |

Scaffold with one command, then add components as needed:

```sh
pnpm dlx shadcn@latest init -t vite
pnpm dlx shadcn@latest add button card field input
```

You can also build the theme visually in shadcn/create and paste the generated
`init --preset` command instead.

## Design tokens

All visual decisions live as CSS variables in one file, `src/styles/globals.css`, so a rebrand
is a change to a few lines. Feature code uses only semantic utilities such as `bg-primary` and
`text-muted-foreground`, never raw colours such as `bg-blue-500`.

### Colour

Keep the shadcn/ui Neutral base for surfaces, text and borders, and override only the brand
and status tokens below. The brand blue is a placeholder until a real colour is given.

| Token                                                         | Role                            | Light                | Dark                 |
| ------------------------------------------------------------- | ------------------------------- | -------------------- | -------------------- |
| `primary`                                                     | Main actions, selected states   | `oklch(0.51 0.19 264)` | `oklch(0.68 0.16 264)` |
| `primary-foreground`                                          | Text on primary                 | `oklch(0.985 0 0)`   | `oklch(0.145 0 0)`   |
| `ring`                                                        | Focus rings                     | `oklch(0.51 0.19 264)` | `oklch(0.68 0.16 264)` |
| `destructive`                                                 | Delete, errors                  | shadcn default       | shadcn default       |
| `success` (new)                                               | Confirmations, positive status  | `oklch(0.52 0.14 150)` | `oklch(0.70 0.15 150)` |
| `warning` (new)                                               | Caution, pending status         | `oklch(0.84 0.16 84)`  | `oklch(0.41 0.11 46)`  |
| `info` (new)                                                  | Neutral notices                 | `oklch(0.55 0.13 235)` | `oklch(0.72 0.12 235)` |
| `background`, `card`, `popover`, `muted`, `accent`, `border`, `input` | Surfaces and lines      | shadcn Neutral       | shadcn Neutral       |

Each new token needs a `-foreground` partner and an entry in `@theme inline`, following the
pattern in the shadcn/ui theming docs:

```css
:root {
  --success: oklch(0.52 0.14 150);
  --success-foreground: oklch(0.985 0 0);
}
.dark {
  --success: oklch(0.70 0.15 150);
  --success-foreground: oklch(0.145 0 0);
}
@theme inline {
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
}
```

The colour values are starting proposals; check every foreground and background pair for
4.5:1 contrast before locking them.

### Typography

One typeface, Inter Variable, in six sizes. Body text is 16 px on every screen, which also
stops iOS Safari from zooming into focused inputs.

| Style         | Size / line height | Weight     | Tailwind classes                           | Use                                |
| ------------- | ------------------ | ---------- | ------------------------------------------ | ---------------------------------- |
| Display       | 30 / 36 px         | 600        | `text-3xl font-semibold tracking-tight`    | Landing and empty-screen titles    |
| Page title    | 24 / 32 px         | 600        | `text-2xl font-semibold tracking-tight`    | One per screen                     |
| Section title | 20 / 28 px         | 600        | `text-xl font-semibold`                    | Card and section headings          |
| Body          | 16 / 24 px         | 400        | `text-base`                                | Default text, inputs               |
| Small         | 14 / 20 px         | 400 or 500 | `text-sm`                                  | Labels, table cells, helper text   |
| Caption       | 12 / 16 px         | 400        | `text-xs text-muted-foreground`            | Timestamps, badges                 |

### Spacing, radius, elevation and motion

| Token group  | Values                                                                      | Rule                                                      |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Spacing      | 4, 8, 12, 16, 24, 32, 48, 64 px (Tailwind 1, 2, 3, 4, 6, 8, 12, 16)         | Use only these steps for padding, margin and gap.         |
| Page padding | 16 px phone, 24 px tablet, 32 px desktop                                    | `px-4 md:px-6 lg:px-8` on the page container.             |
| Content width | 1280 px maximum                                                            | `max-w-7xl mx-auto`.                                      |
| Radius       | `--radius: 0.625rem` (10 px)                                                | `rounded-md` for controls, `rounded-lg` for cards, `rounded-xl` for dialogs. |
| Elevation    | `shadow-xs` inputs, `shadow-sm` cards, `shadow-md` popovers, `shadow-lg` dialogs | Borders first; shadows only on floating layers.      |
| Motion       | 150 ms hover and press, 200 ms popovers and dialogs, 300 ms drawers and sheets, ease-out | Disable non-essential motion under `prefers-reduced-motion`. |
| Icons        | 16 px inline, 20 px in buttons and navigation                               | lucide-react, default stroke width.                       |

## Responsive and touch rules

Design every screen for the phone first, then add `md:` and `lg:` classes for tablet and
desktop. Three layouts cover all devices, using Tailwind's default breakpoints.

|              | Phone (under 768 px)              | Tablet (768 to 1023 px, `md:`) | Desktop (1024 px and up, `lg:`) |
| ------------ | --------------------------------- | ------------------------------ | ------------------------------- |
| Navigation   | Bottom tab bar, up to 5 items     | Sidebar collapsed to icons     | Full sidebar with labels        |
| Layout       | Single column                     | Two columns where useful       | Multi-column, 1280 px max width |
| Modals       | Drawer from the bottom            | Dialog                         | Dialog                          |
| Side panels  | Full-screen Sheet                 | Sheet, 400 px wide             | Sheet or inline panel           |
| Tables       | Card list, one record per card    | Table with key columns         | Full table                      |
| Forms        | One field per row, sticky submit bar | Two fields per row          | Two fields per row, 640 px max width |
| Menus        | Drawer action list                | DropdownMenu                   | DropdownMenu                    |

Touch rules that apply on every touch device:

- Every tappable target is at least 44 by 44 px. Add a `touch` size to Button and icon
  buttons (`h-11`), and apply it on coarse pointers.
- Keep at least 8 px between adjacent targets.
- Never rely on hover. Anything shown in a Tooltip must also be reachable by tap or visible
  as a label.
- Respect device safe areas: pad the bottom tab bar and sticky footers with
  `env(safe-area-inset-bottom)`.
- Use `min-h-svh` instead of `min-h-screen` so mobile browser toolbars do not cut off
  content.
- Support both orientations on tablet; do not lock rotation.

## Components

Install components in three tiers, only when a screen needs them, and build nine app-level
patterns on top. All names below are current shadcn/ui components.

| Tier                        | When                          | Components                                                                                     |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Foundations              | Phase 3, before any screen    | button, input, textarea, label, field, select, checkbox, radio-group, switch, card, badge, separator, skeleton, spinner, tooltip |
| 2. Overlays and navigation  | Phase 4, with the app shell   | dialog, alert-dialog, drawer, sheet, dropdown-menu, popover, tabs, sidebar, breadcrumb, toast  |
| 3. Data and specialised     | As features need them         | table, data-table, pagination, empty, avatar, calendar, date-picker, combobox, command, chart  |

App patterns live in `src/components/patterns` and are the only place responsive switching
logic is written:

| Pattern          | Built from                          | What it does                                    |
| ---------------- | ----------------------------------- | ----------------------------------------------- |
| AppShell         | sidebar, custom tab bar             | Sidebar from `md:` up, bottom tab bar on phone. |
| PageHeader       | breadcrumb, button                  | Title, optional description, primary action.    |
| ResponsiveDialog | dialog, drawer                      | Dialog from `md:` up, bottom drawer on phone.   |
| ResponsiveMenu   | dropdown-menu, drawer               | Dropdown from `md:` up, action drawer on phone. |
| FormSection      | field, input, React Hook Form, Zod  | Label, control, help text and error in one layout. |
| DataList         | table, card                         | Table from `md:` up, card list on phone.        |
| ConfirmDialog    | alert-dialog                        | One standard destructive-action confirmation.   |
| StateViews       | empty, skeleton, spinner            | Standard empty, loading and error states.       |
| ThemeToggle      | dropdown-menu                       | Light, dark and system themes via the `.dark` class. |

## Code conventions

Three folders separate what shadcn/ui gives you, what the design system adds, and what the
app builds.

```text
src/
  styles/globals.css        tokens: colours, radius, fonts, dark theme
  lib/utils.ts              cn() class-merging helper
  hooks/                    use-media-query, use-theme
  components/
    ui/                     shadcn/ui components, added by the CLI
    patterns/               AppShell, ResponsiveDialog, DataList, ...
  features/<feature>/       screens and feature-only components
  routes/design-system.tsx  live gallery of every token and component
```

Rules for everyone who writes UI code:

1. Colours, radius and shadows come from tokens. A raw colour class or hex value in
   `features/` fails review.
2. Variants are defined with `cva` inside the component file. Do not restyle a component from
   outside with long `className` overrides; add a variant instead.
3. Edit files in `components/ui` only for system-wide changes, and note each change in
   `CHANGELOG.md` so CLI updates can be merged safely.
4. Features import from `components/patterns` first, `components/ui` second, and never from
   the primitive library directly.
5. Responsive switching uses Tailwind breakpoints in class names. Use the `use-media-query`
   hook only when the component itself changes, as in ResponsiveDialog.
6. One component per file, kebab-case file names, PascalCase exports.

Accessibility rules, checked in Phase 5:

- Every interactive element is reachable and operable by keyboard, with a visible focus ring.
- Every input has a visible label through Field; placeholders are not labels.
- Text contrast is at least 4.5:1, and 3:1 for large text and control borders.
- Icon-only buttons carry an `aria-label`.
- Status is never shown by colour alone; pair it with an icon or text.

## Implementation plan

Six phases take the system from an empty repository to a documented, tested library in about
16 working days for one developer. The day counts are estimates. Phases run in order because
each builds on the last; do not start a phase until the previous gate passes. (In this
repository the phases are renumbered 16 to 21 and reshaped; see #39.)

### Phase 1: Scaffold (1 day)

1. Create the project with `shadcn@latest init -t vite`, choosing Base UI and the Neutral base
   colour.
2. Confirm the `@/` alias, `components.json` and `globals.css` were generated.
3. Add ESLint, Prettier with the Tailwind class-sorting plugin, and TypeScript strict mode.
4. Set up a CI job that runs type-check, lint and build on every pull request.

Gate: a Button renders in the browser and CI is green.

### Phase 2: Tokens and theme (2 days)

1. Replace `primary` and `ring` with the brand values; add `success`, `warning` and `info`
   pairs.
2. Self-host Inter Variable and set it as `--font-sans`.
3. Add the theme provider and ThemeToggle for light, dark and system modes.
4. Check every foreground and background pair for contrast in both themes.
5. Build the first version of the `/design-system` route showing colours, type and spacing.

Gate: both themes pass contrast, and no hard-coded colours exist outside `globals.css`.

### Phase 3: Core components (3 days)

1. Install the Tier 1 components.
2. Add the `touch` size to Button and set 16 px text on inputs.
3. Add `success`, `warning` and `info` variants to Badge and alerts.
4. Show every component, variant and state on the `/design-system` route.
5. Write interaction tests for Button, Field and Select.

Gate: every Tier 1 component is in the gallery in both themes and works by keyboard.

### Phase 4: App shell and patterns (5 days)

1. Install the Tier 2 components.
2. Build AppShell with sidebar, bottom tab bar and safe-area padding.
3. Build ResponsiveDialog, ResponsiveMenu, ConfirmDialog and PageHeader.
4. Build FormSection with React Hook Form and Zod validation.
5. Build DataList and StateViews.
6. Build one real screen end to end as the reference implementation.

Gate: the reference screen works at 375, 768 and 1280 px widths with no horizontal scroll.

### Phase 5: Quality (3 days)

1. Add Playwright with axe to scan the gallery and the reference screen.
2. Add screenshot tests at phone, tablet and desktop widths in both themes.
3. Test on a real iPhone, Android phone and tablet, in both orientations.
4. Measure the production bundle and remove unused components.
5. Add the PWA manifest and icons if you want home-screen install.

Gate: zero axe violations, screenshots approved, and target sizes verified on devices.

### Phase 6: Document and govern (2 days)

1. Write a one-page usage guide: tokens, patterns, and the six code rules.
2. Add a lint rule that blocks raw colour classes in `features/`.
3. Add a pull-request checklist for new components: variants, states, themes, keyboard,
   gallery entry.
4. Start `CHANGELOG.md` for changes to `components/ui`.
5. Schedule a monthly check of the shadcn/ui changelog for updates worth merging.

Gate: a new team member can build a screen using only the guide and the gallery.

## Open questions

1. What does the app do, and who uses it? This decides which Tier 3 components and patterns
   matter.
2. Is there a brand colour, logo or font? They replace the placeholder blue and Inter.
3. Vite single-page app, or Next.js with server rendering?
4. Is the app data-heavy (tables, charts, dashboards) or content-and-forms?
5. Is home-screen install and offline use needed on phone and tablet?

The build spec (Part 2) locks a default for each one.

## Sources

- shadcn/ui: Vite installation, for the scaffold commands and the current component list.
- shadcn/ui: Theming, for the token names, radius scale, base colours and the pattern for
  adding new tokens.
- shadcn/ui: CLI, for the init and add flags used in the build spec.
- shadcn/ui: Button, for the size and variant names and the Base UI `render` and `data-icon`
  conventions.
- Tailwind breakpoints, the typography scale, the spacing rules and the day estimates are
  recommendations, not taken from these pages.

---

# Part 2: Build spec for the coding agent

This part is the executable version of the design system: follow the steps in order and make
no design or tooling choices of your own.

## Rules for the agent

1. Execute Steps 1 to 8 in order; each step ends with checks that must pass before the next
   step starts.
2. Where this part and Part 1 differ, this part wins.
3. Write every block labelled Create or Replace exactly as given. Apply every block labelled
   Edit as the described change and nothing more.
4. Add no dependency, file, component, route, colour or variant that this spec does not name.
5. Files in `src/components/ui` are generated by the shadcn CLI and are the source of truth
   for export and prop names. If a name used in this spec does not exist in the generated
   file, run `pnpm dlx shadcn@latest docs <component>`, use the equivalent name, keep the
   behaviour described here, and record it in `CHANGELOG.md` under "Spec deviations".
6. If the CLI asks a question, answer it from the Locked decisions table. If the table does
   not cover it, stop and report; do not improvise.
7. If a check fails, fix the cause inside the current step. Never skip, weaken or delete a
   check.
8. Commit once per step with the commit message given at the end of the step.

The code blocks were written against the shadcn/ui docs of November 2026 and have not been
compiled. Type errors caused by API drift are fixed under rule 5.

## Locked decisions

Every choice is already made; the owner changes a row here before the build starts, and the
agent never does.

| Topic                              | Decision                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Project folder and package name    | `my-app`                                                                                      |
| Display name                       | My App, stored once in `src/lib/app-config.ts`                                                |
| Runtime                            | Node 24, pinned in `.nvmrc`                                                                   |
| Package manager                    | pnpm; commit `pnpm-lock.yaml`                                                                 |
| Versions                           | Latest stable at install time; after Step 1 no upgrades                                       |
| Build tool                         | Vite, single-page app, no server rendering                                                    |
| Language                           | TypeScript, strict mode, no `any`                                                             |
| shadcn/ui primitive library        | Base UI (`--base base`)                                                                       |
| shadcn/ui preset and style         | Nova (`--preset nova`)                                                                        |
| Base colour                        | Neutral                                                                                       |
| Icon library                       | Lucide (`lucide-react`)                                                                       |
| Button cursor                      | Pointer (`--pointer`)                                                                         |
| Monorepo, RTL                      | No, no                                                                                        |
| Router                             | react-router, `createBrowserRouter`, client-side only                                         |
| Forms and validation               | react-hook-form, zod, @hookform/resolvers                                                     |
| Font                               | Inter Variable via `@fontsource-variable/inter`                                               |
| Themes                             | Light, dark and system; class `.dark` on `<html>`; storage key `app-theme`; default system    |
| Brand colour                       | Blue, `oklch(0.51 0.19 264)` light and `oklch(0.68 0.16 264)` dark                            |
| Phone, tablet, desktop             | Under 768 px; 768 to 1023 px; 1024 px and up                                                  |
| Navigation items                   | Home `/`, Projects `/projects`, Settings `/settings`                                          |
| Reference screen                   | Projects list with create and delete, in-memory data, no backend                              |
| State management                   | React state only; no store library                                                            |
| Data fetching                      | None in this build                                                                            |
| Notifications                      | None in this build; add toast with the first feature that needs it                            |
| Unit tests                         | Vitest, jsdom, Testing Library                                                                |
| End-to-end tests                   | Playwright on Chromium at 375, 768 and 1280 px, with @axe-core/playwright                     |
| CI                                 | GitHub Actions, one workflow                                                                  |
| Formatting                         | Prettier: no semicolons, double quotes, trailing commas, Tailwind class sorting               |
| Language of UI text                | English, sentence case                                                                        |
| Not built by the agent             | PWA and offline support, screenshot baselines, real-device testing, authentication, backend   |

## Step 1: Scaffold

This step produces a running Vite app with shadcn/ui, linting, formatting and test tooling
installed.

Run in the folder that will contain the project:

```sh
pnpm dlx shadcn@latest init -t vite -b base -p nova -n my-app --pointer --no-monorepo --no-rtl
cd my-app
echo "24" > .nvmrc
pnpm add react-router react-hook-form zod @hookform/resolvers @fontsource-variable/inter
pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test @axe-core/playwright prettier prettier-plugin-tailwindcss
pnpm exec playwright install --with-deps chromium
mkdir -p src/styles src/hooks src/components/patterns src/features/projects src/routes src/test e2e docs .github/workflows
git mv src/index.css src/styles/globals.css
```

Edit `components.json`: set `tailwind.css` to `src/styles/globals.css`. Confirm
`tailwind.baseColor` is `neutral`, `tailwind.cssVariables` is `true` and `iconLibrary` is
`lucide`.

Edit `src/main.tsx`: change the CSS import to `import "@/styles/globals.css"`.

Replace `vite.config.ts`:

```ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
```

Edit `tsconfig.app.json`: in `compilerOptions`, set `"strict": true` and set `"types"` to
`["vite/client", "vitest/globals", "@testing-library/jest-dom"]`. Keep the `baseUrl` and
`paths` entries the CLI wrote.

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})
```

Create `.prettierrc.json`:

```json
{
  "semi": false,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 80,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/styles/globals.css",
  "tailwindFunctions": ["cn", "cva"]
}
```

Create `.prettierignore`:

```text
dist
pnpm-lock.yaml
playwright-report
test-results
```

Edit `eslint.config.js`: keep everything the template generated, add `"playwright-report"`
and `"test-results"` to the ignore list, and append this object as the last element of the
exported config array. If the template has no `eslint.config.js`, stop and report.

```js
{
  files: [
    "src/features/**/*.{ts,tsx}",
    "src/components/patterns/**/*.{ts,tsx}",
    "src/routes/**/*.{ts,tsx}",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "Literal[value=/\\b(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|shadow|placeholder)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(-\\d{2,3})?\\b/]",
        message:
          "Use a semantic token class (bg-primary, text-muted-foreground, ...) instead of a raw colour.",
      },
      {
        selector:
          "TemplateElement[value.raw=/\\b(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|shadow|placeholder)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(-\\d{2,3})?\\b/]",
        message:
          "Use a semantic token class (bg-primary, text-muted-foreground, ...) instead of a raw colour.",
      },
    ],
  },
},
```

Edit `package.json`: set the `scripts` block to exactly this.

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview --port 4173 --strictPort",
  "typecheck": "tsc -b",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "vitest run",
  "test:e2e": "playwright test"
}
```

Replace `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <meta name="color-scheme" content="light dark" />
    <title>My App</title>
    <script>
      ;(function () {
        try {
          var stored = localStorage.getItem("app-theme")
          var dark =
            stored === "dark" ||
            ((stored === null || stored === "system") &&
              window.matchMedia("(prefers-color-scheme: dark)").matches)
          document.documentElement.classList.toggle("dark", dark)
        } catch (e) {}
      })()
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/lib/app-config.ts`:

```ts
export const APP_NAME = "My App"
```

Checks: `pnpm format && pnpm typecheck && pnpm lint && pnpm build` all exit 0, and `pnpm dev`
serves the template page.

Commit: `chore: scaffold vite, shadcn/ui and tooling`

## Step 2: Tokens

This step turns the generated Neutral theme into the app theme by editing
`src/styles/globals.css` in five places. Leave every other line the CLI generated untouched.

Edit 1: add this import directly under the existing `@import` lines.

```css
@import "@fontsource-variable/inter";
```

Edit 2: inside the existing `@theme inline { ... }` block, add these lines. If `--font-sans`
already exists there, replace its value.

```css
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
```

Edit 3: inside the existing `:root { ... }` block, replace the values of the tokens that
already exist and add the ones that do not.

```css
  --radius: 0.625rem;
  --primary: oklch(0.51 0.19 264);
  --primary-foreground: oklch(0.985 0 0);
  --ring: oklch(0.51 0.19 264);
  --sidebar-primary: oklch(0.51 0.19 264);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-ring: oklch(0.51 0.19 264);
  --success: oklch(0.52 0.14 150);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.84 0.16 84);
  --warning-foreground: oklch(0.28 0.07 46);
  --info: oklch(0.55 0.13 235);
  --info-foreground: oklch(0.985 0 0);
```

Edit 4: inside the existing `.dark { ... }` block, do the same with these values.

```css
  --primary: oklch(0.68 0.16 264);
  --primary-foreground: oklch(0.145 0 0);
  --ring: oklch(0.68 0.16 264);
  --sidebar-primary: oklch(0.68 0.16 264);
  --sidebar-primary-foreground: oklch(0.145 0 0);
  --sidebar-ring: oklch(0.68 0.16 264);
  --success: oklch(0.70 0.15 150);
  --success-foreground: oklch(0.145 0 0);
  --warning: oklch(0.41 0.11 46);
  --warning-foreground: oklch(0.99 0.02 95);
  --info: oklch(0.72 0.12 235);
  --info-foreground: oklch(0.145 0 0);
```

Edit 5: append this to the end of the file.

```css
@utility pb-safe {
  padding-bottom: env(safe-area-inset-bottom);
}

@utility pb-safe-3 {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}

@layer base {
  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    @apply min-h-svh font-sans antialiased;
  }

  @media (pointer: coarse) {
    [data-slot="button"] {
      min-height: 2.75rem;
      min-width: 2.75rem;
    }

    [data-slot="input"],
    [data-slot="select-trigger"],
    [data-slot="tabs-trigger"] {
      min-height: 2.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    ::before,
    ::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
```

Usage rules that follow from these tokens, applied in every later step:

| Need                                | Use exactly                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Page title                          | `<h1 className="text-2xl font-semibold tracking-tight">`                     |
| Section title                       | `<h2 className="text-xl font-semibold">`                                     |
| Body text                           | no class (16 px inherited)                                                   |
| Secondary text                      | `text-sm text-muted-foreground`                                              |
| Caption                             | `text-xs text-muted-foreground`                                              |
| Vertical gap between page sections  | `space-y-6`                                                                  |
| Gap between form fields             | `gap-4`                                                                      |
| Gap inside a card                   | `gap-3`                                                                      |
| Card padding                        | the Card component default; never override                                   |
| Icon in a button or nav item        | `className="size-5"` with `aria-hidden="true"`                               |
| Inline icon in text                 | `className="size-4"` with `aria-hidden="true"`                               |
| Allowed spacing utilities           | steps 1, 2, 3, 4, 6, 8, 12, 16 only                                          |

Checks: `pnpm build` exits 0. In the browser,
`getComputedStyle(document.documentElement).getPropertyValue("--primary")` returns the light
value, and returns the dark value after adding class `dark` to `<html>`.

Commit: `feat: add brand, status and typography tokens`

## Step 3: Theme and hooks

This step adds theme switching and the two hooks every pattern uses. Create these six files.

Create `src/lib/breakpoints.ts`:

```ts
export const MD_UP = "(min-width: 48rem)"
export const LG_UP = "(min-width: 64rem)"
```

Create `src/hooks/use-media-query.ts`:

```ts
import { useCallback, useSyncExternalStore } from "react"

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
```

Create `src/lib/theme-context.ts`:

```ts
import { createContext } from "react"

export type Theme = "light" | "dark" | "system"

export type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const THEME_STORAGE_KEY = "app-theme"

export const ThemeContext = createContext<ThemeContextValue | null>(null)
```

Create `src/components/theme-provider.tsx`:

```tsx
import { useEffect, useMemo, useState, type ReactNode } from "react"

import {
  ThemeContext,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme-context"

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored
    }
  } catch {
    // Storage is unavailable; fall through to the default.
  }
  return "system"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme: (next: Theme) => {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next)
        } catch {
          // Storage is unavailable; the choice lasts for this session only.
        }
        setThemeState(next)
      },
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
```

Create `src/hooks/use-theme.ts`:

```ts
import { useContext } from "react"

import { ThemeContext, type ThemeContextValue } from "@/lib/theme-context"

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === null) {
    throw new Error("useTheme must be used inside ThemeProvider")
  }
  return context
}
```

Create `src/components/patterns/theme-toggle.tsx`. It is one button that cycles light, dark,
system, so it needs no menu.

```tsx
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"
import type { Theme } from "@/lib/theme-context"

const NEXT: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
}

const LABEL: Record<Theme, string> = {
  light: "Theme: light. Switch to dark",
  dark: "Theme: dark. Switch to system",
  system: "Theme: system. Switch to light",
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon =
    theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : MonitorIcon

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={LABEL[theme]}
      onClick={() => setTheme(NEXT[theme])}
    >
      <Icon className="size-5" aria-hidden="true" />
    </Button>
  )
}
```

Create `src/components/theme-provider.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ThemeToggle } from "@/components/patterns/theme-toggle"
import { ThemeProvider } from "@/components/theme-provider"

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("dark")
  })

  it("cycles system, light, dark and stores the choice", async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )

    await user.click(screen.getByRole("button", { name: /theme: system/i }))
    expect(localStorage.getItem("app-theme")).toBe("light")
    expect(document.documentElement).not.toHaveClass("dark")

    await user.click(screen.getByRole("button", { name: /theme: light/i }))
    expect(localStorage.getItem("app-theme")).toBe("dark")
    expect(document.documentElement).toHaveClass("dark")
  })
})
```

Checks: `pnpm typecheck && pnpm lint && pnpm test` exit 0. Before the checks, run
`pnpm dlx shadcn@latest add -y button` if `src/components/ui/button.tsx` does not exist yet.

Commit: `feat: add theme provider, toggle and media query hook`

## Step 4: Components

This step installs exactly 27 shadcn/ui components and makes two edits to them. Install
nothing else.

Run:

```sh
pnpm dlx shadcn@latest add -y button input textarea label field select checkbox radio-group switch card badge separator skeleton spinner tooltip
pnpm dlx shadcn@latest add -y dialog alert-dialog drawer sheet dropdown-menu popover tabs sidebar breadcrumb
pnpm dlx shadcn@latest add -y table empty avatar
```

If the CLI asks whether to overwrite an existing file, answer no.

Edit `src/components/ui/button.tsx`: inside the `size` object of `buttonVariants`, add these
two entries after the last existing size. Change nothing else.

```ts
        touch: "h-11 px-5 text-base",
        "icon-touch": "size-11",
```

Edit `src/components/ui/badge.tsx`: inside the `variant` object of `badgeVariants`, add these
three entries after the last existing variant. Change nothing else.

```ts
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
        info: "border-transparent bg-info text-info-foreground",
```

Verify, do not edit `src/components/ui/input.tsx` and `textarea.tsx`: the class list contains
`text-base` and `md:text-sm`. If it does not, add `text-base md:text-sm` to the class list
and record it in `CHANGELOG.md`.

How to use the components, fixed for the whole app:

| Situation                              | Use exactly                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Main action of a screen or dialog      | `<Button>` (default variant), one per view                                                   |
| Secondary action                       | `<Button variant="outline">`                                                                 |
| Low-emphasis action, toolbar icons     | `<Button variant="ghost">`                                                                   |
| Delete or irreversible action          | `<Button variant="destructive">`, always behind ConfirmDialog                                |
| Icon-only button                       | `size="icon"` plus `aria-label`                                                              |
| Link styled as a button                | `<Link className={buttonVariants({ variant: "outline" })}>`; never Button with `render`      |
| Icon inside a text button              | add `data-icon="inline-start"` or `data-icon="inline-end"` to the icon                       |
| Loading button                         | `disabled`, with `<Spinner data-icon="inline-start" />` before the label                     |
| Trigger of a menu, popover or tooltip  | `render={<Button ... />}` on the trigger part (Base UI pattern)                              |
| Status label                           | `<Badge variant="success" \| "warning" \| "info" \| "destructive" \| "secondary">`           |
| Text input with label                  | `TextField` from `form-section.tsx` (Step 5)                                                 |
| Checkbox, switch or radio              | Inside `<Field orientation="horizontal">` with a `FieldLabel`, row class `min-h-11`         |

Create `src/components/ui/button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import { Button } from "@/components/ui/button"

describe("Button", () => {
  it("calls onClick and exposes its label", async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("does not fire when disabled", async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it("supports the touch size", () => {
    render(<Button size="touch">Save</Button>)
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("h-11")
  })
})
```

Create `CHANGELOG.md`:

```md
# Design system changelog

## Changes to components/ui

- button: added sizes `touch` and `icon-touch`.
- badge: added variants `success`, `warning` and `info`.

## Spec deviations

- None.
```

Checks: `pnpm format && pnpm typecheck && pnpm lint && pnpm test` exit 0.

Commit: `feat: install shadcn/ui components and add touch and status variants`

## Step 5: Patterns

This step creates the eight pattern files and the navigation config that every screen
composes. Create each file exactly; rule 5 applies to any shadcn/ui export that differs.

Create `src/lib/navigation.ts`:

```ts
import {
  FolderIcon,
  HouseIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: HouseIcon },
  { to: "/projects", label: "Projects", icon: FolderIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
]
```

Create `src/components/patterns/app-shell.tsx`. Phone shows a bottom tab bar, tablet an
icon-only sidebar, desktop a full sidebar that the trigger can collapse.

```tsx
import { useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router"

import { ThemeToggle } from "@/components/patterns/theme-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useMediaQuery } from "@/hooks/use-media-query"
import { APP_NAME } from "@/lib/app-config"
import { LG_UP } from "@/lib/breakpoints"
import { NAV_ITEMS } from "@/lib/navigation"
import { cn } from "@/lib/utils"

function isActivePath(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to)
}

export function AppShell() {
  const isLgUp = useMediaQuery(LG_UP)
  const [expanded, setExpanded] = useState(true)
  const { pathname } = useLocation()

  return (
    <SidebarProvider open={isLgUp && expanded} onOpenChange={setExpanded}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <Sidebar collapsible="icon">
        <SidebarHeader>
          <span className="truncate px-2 py-1 text-sm font-semibold group-data-[collapsible=icon]:hidden">
            {APP_NAME}
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={isActivePath(pathname, item.to)}
                      tooltip={item.label}
                      render={<NavLink to={item.to} end={item.to === "/"} />}
                    >
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <ThemeToggle />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4 md:px-6 lg:px-8">
          <SidebarTrigger className="hidden lg:inline-flex" />
          <span className="font-semibold md:hidden">{APP_NAME}</span>
          <div className="ml-auto md:hidden">
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-24 outline-none md:px-6 md:pb-6 lg:px-8"
        >
          <Outlet />
        </main>
      </SidebarInset>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-safe md:hidden"
      >
        <ul className="flex">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.to)
            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 text-xs",
                    active
                      ? "font-medium text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  <item.icon className="size-5" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
    </SidebarProvider>
  )
}
```

Create `src/components/patterns/page-header.tsx`:

```tsx
import type { ReactNode } from "react"

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}
```

Create `src/components/patterns/responsive-dialog.tsx`. It is always controlled through
`open` and `onOpenChange`; it has no trigger part.

```tsx
import type { ReactNode } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useMediaQuery } from "@/hooks/use-media-query"
import { MD_UP } from "@/lib/breakpoints"

type ResponsiveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: ResponsiveDialogProps) {
  const isMdUp = useMediaQuery(MD_UP)

  if (isMdUp) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4">{children}</div>
        {footer ? (
          <DrawerFooter className="pb-safe-3">{footer}</DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
```

Create `src/components/patterns/confirm-dialog.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

Create `src/components/patterns/responsive-menu.tsx`:

```tsx
import { useState, type ReactNode } from "react"
import { MoreHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMediaQuery } from "@/hooks/use-media-query"
import { MD_UP } from "@/lib/breakpoints"
import { cn } from "@/lib/utils"

export type MenuAction = {
  id: string
  label: string
  icon?: ReactNode
  destructive?: boolean
  onSelect: () => void
}

type ResponsiveMenuProps = {
  label: string
  actions: MenuAction[]
}

export function ResponsiveMenu({ label, actions }: ResponsiveMenuProps) {
  const isMdUp = useMediaQuery(MD_UP)
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (isMdUp) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={label} />}
        >
          <MoreHorizontalIcon className="size-5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              variant={action.destructive ? "destructive" : "default"}
              onClick={action.onSelect}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={() => setDrawerOpen(true)}
      >
        <MoreHorizontalIcon className="size-5" aria-hidden="true" />
      </Button>
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>{label}</DrawerTitle>
            <DrawerDescription className="sr-only">
              Choose an action
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-1 px-4 pb-safe-3">
            {actions.map((action) => (
              <Button
                key={action.id}
                variant="ghost"
                size="touch"
                className={cn(
                  "justify-start",
                  action.destructive && "text-destructive",
                )}
                onClick={() => {
                  setDrawerOpen(false)
                  action.onSelect()
                }}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
```

Create `src/components/patterns/data-list.tsx`. It renders cards under 768 px and a table
from 768 px, switched by CSS only.

```tsx
import type { ReactNode } from "react"

import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type DataListColumn<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
  primary?: boolean
  desktopOnly?: boolean
}

type DataListProps<T> = {
  caption: string
  rows: T[]
  columns: DataListColumn<T>[]
  getRowId: (row: T) => string
  rowActions?: (row: T) => ReactNode
}

export function DataList<T>({
  caption,
  rows,
  columns,
  getRowId,
  rowActions,
}: DataListProps<T>) {
  const primary = columns.find((column) => column.primary) ?? columns[0]
  const secondary = columns.filter((column) => column !== primary)

  return (
    <>
      <ul aria-label={caption} className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={getRowId(row)}>
            <Card>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{primary.cell(row)}</div>
                  {rowActions ? rowActions(row) : null}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {secondary.map((column) => (
                    <div key={column.id}>
                      <dt className="text-xs text-muted-foreground">
                        {column.header}
                      </dt>
                      <dd>{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(column.desktopOnly && "hidden lg:table-cell")}
                >
                  {column.header}
                </TableHead>
              ))}
              {rowActions ? (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={getRowId(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      column.primary && "font-medium",
                      column.desktopOnly && "hidden lg:table-cell",
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
                {rowActions ? <TableCell>{rowActions(row)}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
```

Create `src/components/patterns/form-section.tsx`:

```tsx
import type { HTMLInputTypeAttribute, ReactNode } from "react"
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type FormSectionProps = {
  title: string
  description?: string
  children: ReactNode
}

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldGroup className="grid gap-4 md:grid-cols-2">{children}</FieldGroup>
    </FieldSet>
  )
}

type TextFieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  label: string
  description?: string
  type?: HTMLInputTypeAttribute
  autoComplete?: string
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  type = "text",
  autoComplete = "off",
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Input
            {...field}
            id={field.name}
            type={type}
            autoComplete={autoComplete}
            aria-invalid={fieldState.invalid}
          />
          {description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : null}
        </Field>
      )}
    />
  )
}

export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background px-4 pt-3 pb-safe-3 md:static md:mx-0 md:justify-end md:border-0 md:p-0">
      {children}
    </div>
  )
}
```

Create `src/components/patterns/state-views.tsx`:

```tsx
import type { ReactNode } from "react"
import { CircleAlertIcon, InboxIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

type EmptyStateProps = {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

type ErrorStateProps = {
  title: string
  description: string
  onRetry: () => void
}

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}
```

Checks: `pnpm format && pnpm typecheck && pnpm lint && pnpm test` exit 0.

Commit: `feat: add app shell and responsive patterns`

## Step 6: Routes and screens

This step wires five routes into the shell and builds the Projects reference screen. All data
is in memory.

| Route          | File                                         | Content                                  |
| -------------- | -------------------------------------------- | ---------------------------------------- |
| `/`            | `src/routes/home.tsx`                        | Welcome card linking to Projects         |
| `/projects`    | `src/features/projects/projects-page.tsx`    | List, create and delete projects         |
| `/settings`    | `src/routes/settings.tsx`                    | Theme row and link to the gallery        |
| `/design-system` | `src/routes/design-system.tsx`             | Gallery of tokens, components and states |
| any other path | `src/routes/not-found.tsx`                   | Not-found message with a link home       |

Replace `src/main.tsx`:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router/dom"

import "@/styles/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { router } from "@/router"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
)
```

Create `src/router.tsx`, then delete `src/App.tsx`, `src/App.css` and `src/assets` if the
template created them.

```tsx
import { createBrowserRouter } from "react-router"

import { AppShell } from "@/components/patterns/app-shell"
import { ProjectsPage } from "@/features/projects/projects-page"
import { DesignSystemPage } from "@/routes/design-system"
import { HomePage } from "@/routes/home"
import { NotFoundPage } from "@/routes/not-found"
import { SettingsPage } from "@/routes/settings"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "design-system", element: <DesignSystemPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])
```

Create `src/routes/home.tsx`:

```tsx
import { Link } from "react-router"

import { PageHeader } from "@/components/patterns/page-header"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { APP_NAME } from "@/lib/app-config"

export function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Home" description={`Welcome to ${APP_NAME}.`} />
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>Create and manage your projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to="/projects"
            className={buttonVariants({ variant: "outline" })}
          >
            Open projects
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
```

Create `src/routes/settings.tsx`:

```tsx
import { Link } from "react-router"

import { PageHeader } from "@/components/patterns/page-header"
import { ThemeToggle } from "@/components/patterns/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Preferences for this device." />
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex min-h-11 items-center justify-between gap-4">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-muted-foreground">
                Switch between light, dark and system.
              </p>
            </div>
            <ThemeToggle />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-4">
            <div>
              <p className="font-medium">Design system</p>
              <p className="text-sm text-muted-foreground">
                Every token, component and state in one place.
              </p>
            </div>
            <Link
              to="/design-system"
              className={buttonVariants({ variant: "outline" })}
            >
              Open gallery
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

Create `src/routes/not-found.tsx`:

```tsx
import { Link } from "react-router"

import { EmptyState } from "@/components/patterns/state-views"
import { buttonVariants } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist."
        action={
          <Link to="/" className={buttonVariants()}>
            Go to home
          </Link>
        }
      />
    </div>
  )
}
```

Create `src/features/projects/types.ts`:

```ts
export type ProjectStatus = "active" | "paused" | "done"

export type Project = {
  id: string
  name: string
  owner: string
  status: ProjectStatus
  updatedAt: string
}
```

Create `src/features/projects/data.ts`:

```ts
import type { Project, ProjectStatus } from "@/features/projects/types"

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  paused: "Paused",
  done: "Done",
}

export const STATUS_VARIANT: Record<
  ProjectStatus,
  "success" | "warning" | "secondary"
> = {
  active: "success",
  paused: "warning",
  done: "secondary",
}

export const SEED_PROJECTS: Project[] = [
  {
    id: "p-1",
    name: "Website redesign",
    owner: "Alex Morgan",
    status: "active",
    updatedAt: "2026-11-10T09:00:00.000Z",
  },
  {
    id: "p-2",
    name: "Mobile onboarding",
    owner: "Sam Rivera",
    status: "active",
    updatedAt: "2026-11-06T09:00:00.000Z",
  },
  {
    id: "p-3",
    name: "Billing migration",
    owner: "Priya Shah",
    status: "paused",
    updatedAt: "2026-10-28T09:00:00.000Z",
  },
  {
    id: "p-4",
    name: "Customer survey",
    owner: "Jordan Lee",
    status: "done",
    updatedAt: "2026-10-15T09:00:00.000Z",
  },
]
```

Create `src/features/projects/project-form.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { TextField } from "@/components/patterns/form-section"
import { FieldGroup } from "@/components/ui/field"

const projectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters")
    .max(60, "Use 60 characters or fewer"),
  owner: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters")
    .max(60, "Use 60 characters or fewer"),
})

export type ProjectFormValues = z.infer<typeof projectSchema>

export const PROJECT_FORM_ID = "project-form"

type ProjectFormProps = {
  onSubmit: (values: ProjectFormValues) => void
}

export function ProjectForm({ onSubmit }: ProjectFormProps) {
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: "", owner: "" },
  })

  return (
    <form
      id={PROJECT_FORM_ID}
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <FieldGroup>
        <TextField control={form.control} name="name" label="Project name" />
        <TextField
          control={form.control}
          name="owner"
          label="Owner"
          autoComplete="name"
        />
      </FieldGroup>
    </form>
  )
}
```

Create `src/features/projects/projects-page.tsx`:

```tsx
import { useState } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog } from "@/components/patterns/confirm-dialog"
import {
  DataList,
  type DataListColumn,
} from "@/components/patterns/data-list"
import { PageHeader } from "@/components/patterns/page-header"
import { ResponsiveDialog } from "@/components/patterns/responsive-dialog"
import { ResponsiveMenu } from "@/components/patterns/responsive-menu"
import { EmptyState } from "@/components/patterns/state-views"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  SEED_PROJECTS,
  STATUS_LABEL,
  STATUS_VARIANT,
} from "@/features/projects/data"
import {
  PROJECT_FORM_ID,
  ProjectForm,
  type ProjectFormValues,
} from "@/features/projects/project-form"
import type { Project } from "@/features/projects/types"

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(SEED_PROJECTS)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  const columns: DataListColumn<Project>[] = [
    {
      id: "name",
      header: "Name",
      primary: true,
      cell: (project) => project.name,
    },
    { id: "owner", header: "Owner", cell: (project) => project.owner },
    {
      id: "status",
      header: "Status",
      cell: (project) => (
        <Badge variant={STATUS_VARIANT[project.status]}>
          {STATUS_LABEL[project.status]}
        </Badge>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      desktopOnly: true,
      cell: (project) => dateFormat.format(new Date(project.updatedAt)),
    },
  ]

  function handleCreate(values: ProjectFormValues) {
    setProjects((current) => [
      {
        id: crypto.randomUUID(),
        name: values.name,
        owner: values.owner,
        status: "active",
        updatedAt: new Date().toISOString(),
      },
      ...current,
    ])
    setCreateOpen(false)
  }

  function handleDelete() {
    if (deleteTarget !== null) {
      const id = deleteTarget.id
      setProjects((current) => current.filter((project) => project.id !== id))
    }
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Create and manage your projects."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            New project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to get started."
        />
      ) : (
        <DataList
          caption="Projects"
          rows={projects}
          columns={columns}
          getRowId={(project) => project.id}
          rowActions={(project) => (
            <ResponsiveMenu
              label={`Actions for ${project.name}`}
              actions={[
                {
                  id: "delete",
                  label: "Delete",
                  destructive: true,
                  icon: <Trash2Icon aria-hidden="true" />,
                  onSelect: () => setDeleteTarget(project),
                },
              ]}
            />
          )}
        />
      )}

      <ResponsiveDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New project"
        description="Give the project a name and an owner."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={PROJECT_FORM_ID}>
              Create project
            </Button>
          </>
        }
      >
        <ProjectForm onSubmit={handleCreate} />
      </ResponsiveDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete project?"
        description={
          deleteTarget !== null
            ? `${deleteTarget.name} will be removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete project"
        onConfirm={handleDelete}
      />
    </div>
  )
}
```

Create `src/routes/design-system.tsx`. The gallery shows exactly these six sections, in this
order.

```tsx
import type { ReactNode } from "react"

import { PageHeader } from "@/components/patterns/page-header"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/patterns/state-views"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

const COLOUR_TOKENS = [
  "background",
  "foreground",
  "card",
  "popover",
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
  "success",
  "warning",
  "info",
  "border",
  "input",
  "ring",
] as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function DesignSystemPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Design system"
        description="Tokens, components and states used across the app."
      />

      <Section title="Colours">
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {COLOUR_TOKENS.map((token) => (
            <li key={token} className="space-y-1">
              <div
                className="h-12 rounded-md border"
                style={{ backgroundColor: `var(--${token})` }}
              />
              <p className="text-xs text-muted-foreground">{token}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <div className="space-y-2">
          <p className="text-3xl font-semibold tracking-tight">Display 30/36</p>
          <p className="text-2xl font-semibold tracking-tight">
            Page title 24/32
          </p>
          <p className="text-xl font-semibold">Section title 20/28</p>
          <p>Body 16/24</p>
          <p className="text-sm">Small 14/20</p>
          <p className="text-xs text-muted-foreground">Caption 12/16</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="touch">Touch</Button>
          <Button disabled>Disabled</Button>
          <Button disabled>
            <Spinner data-icon="inline-start" />
            Saving
          </Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-xl gap-4">
          <Field>
            <FieldLabel htmlFor="ds-input">Text input</FieldLabel>
            <Input id="ds-input" placeholder="Placeholder" />
            <FieldDescription>Helper text sits under the input.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ds-textarea">Text area</FieldLabel>
            <Textarea id="ds-textarea" />
          </Field>
          <Field orientation="horizontal" className="min-h-11">
            <Checkbox id="ds-checkbox" />
            <FieldLabel htmlFor="ds-checkbox">Checkbox</FieldLabel>
          </Field>
          <Field orientation="horizontal" className="min-h-11">
            <Switch id="ds-switch" />
            <FieldLabel htmlFor="ds-switch">Switch</FieldLabel>
          </Field>
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-6 md:grid-cols-3">
          <LoadingState label="Loading example" />
          <EmptyState
            title="Nothing here yet"
            description="Empty states explain what will appear."
          />
          <ErrorState
            title="Something went wrong"
            description="Error states offer a way to retry."
            onRetry={() => undefined}
          />
        </div>
      </Section>
    </div>
  )
}
```

Checks: `pnpm format && pnpm typecheck && pnpm lint && pnpm test && pnpm build` exit 0. In
`pnpm dev`, all five routes render, a project can be created and deleted, and the theme
toggle works.

Commit: `feat: add routes, gallery and projects reference screen`

## Step 7: Quality

This step adds end-to-end, accessibility and layout tests at three viewport sizes, and a CI
workflow that runs every check.

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "phone",
      use: {
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "tablet",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

Create `e2e/a11y.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const ROUTES = ["/", "/projects", "/settings", "/design-system"]
const THEMES = ["light", "dark"] as const

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`${route} has no axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        window.localStorage.setItem("app-theme", value)
      }, theme)
      await page.goto(route)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()

      expect(results.violations).toEqual([])
    })
  }
}
```

Create `e2e/layout.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

const ROUTES = ["/", "/projects", "/settings", "/design-system"]

for (const route of ROUTES) {
  test(`${route} has no horizontal scroll`, async ({ page }) => {
    await page.goto(route)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
    expect(overflows).toBe(false)
  })
}

test("navigation matches the viewport", async ({ page }, testInfo) => {
  await page.goto("/")
  const tabBar = page.getByRole("navigation", { name: "Primary" })

  if (testInfo.project.name === "phone") {
    await expect(tabBar).toBeVisible()
  } else {
    await expect(tabBar).toBeHidden()
    await expect(
      page.getByRole("link", { name: "Projects" }).filter({ visible: true }),
    ).toHaveCount(1)
  }
})

test("tab bar targets are at least 44 px tall", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone only")
  await page.goto("/")
  const links = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link")
  await expect(links).toHaveCount(3)

  for (const link of await links.all()) {
    const box = await link.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
})
```

Create `e2e/projects.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("shows validation errors for an empty form", async ({ page }) => {
  await page.goto("/projects")
  await page.getByRole("button", { name: "New project" }).click()
  await page.getByRole("button", { name: "Create project" }).click()
  await expect(page.getByText("Enter at least 2 characters")).toHaveCount(2)
})

test("creates and deletes a project", async ({ page }) => {
  await page.goto("/projects")

  await page.getByRole("button", { name: "New project" }).click()
  await page.getByLabel("Project name").fill("Launch plan")
  await page.getByLabel("Owner").fill("Taylor Kim")
  await page.getByRole("button", { name: "Create project" }).click()

  const created = page.getByText("Launch plan").filter({ visible: true })
  await expect(created).toHaveCount(1)

  await page.getByRole("button", { name: "Actions for Launch plan" }).click()
  await page
    .getByRole("menuitem", { name: "Delete" })
    .or(page.getByRole("button", { name: "Delete", exact: true }))
    .click()
  await page.getByRole("button", { name: "Delete project" }).click()

  await expect(created).toHaveCount(0)
})
```

Edit `.gitignore`: append two lines, `playwright-report` and `test-results`.

Edit `package.json`: if there is no `packageManager` field, run `corepack use pnpm@latest`
once to add it.

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
```

Fixed responses to failures in this step:

| Failure                                                       | Do exactly this                                                                                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe color-contrast on a token pair                            | In `globals.css`, change only the lightness (first number) of that token's background by 0.02 away from its foreground's lightness; repeat until it passes; record the final value in `CHANGELOG.md`. |
| axe violation inside a `components/ui` file                   | Fix it in that file with the smallest change and record it in `CHANGELOG.md`.                                                                                                    |
| Any other axe violation                                       | Fix the markup in the pattern or route that causes it. Never disable a rule or exclude an element.                                                                               |
| Horizontal scroll                                             | Find the overflowing element and add `min-w-0` or `overflow-x-auto` to its container. Never add `overflow-hidden` to `body`.                                                    |
| A role or name in a test does not match the rendered Base UI markup | Change the locator in the test to the role the component renders, keep the assertion, and record it under "Spec deviations".                                              |

Checks: `pnpm test:e2e` passes in all three projects;
`pnpm format:check && pnpm typecheck && pnpm lint && pnpm test` exit 0.

Commit: `test: add accessibility, layout and flow tests with CI`

## Step 8: Governance

This step adds the three documents that keep the system consistent after the first build.

Create `.github/pull_request_template.md`:

```md
## What changed

## Design system checklist

- [ ] Uses only semantic token classes; no raw colours or hex values
- [ ] Uses patterns from `components/patterns` before `components/ui`
- [ ] New or changed variants are defined with `cva` inside the component file
- [ ] Works at 375, 768 and 1280 px with no horizontal scroll
- [ ] Works in light and dark themes
- [ ] Every control is keyboard operable and has an accessible name
- [ ] Touch targets are at least 44 px
- [ ] New components and states are shown on `/design-system`
- [ ] Changes to `components/ui` are recorded in `CHANGELOG.md`
- [ ] `pnpm format:check`, `typecheck`, `lint`, `test` and `test:e2e` pass
```

Create `docs/design-system.md`:

```md
# Design system guide

## Where things live

- `src/styles/globals.css`: all tokens. Change colours, radius and fonts here only.
- `src/components/ui`: shadcn/ui components added by the CLI.
- `src/components/patterns`: AppShell, PageHeader, ResponsiveDialog, ResponsiveMenu, ConfirmDialog, DataList, FormSection, StateViews, ThemeToggle.
- `src/features/<feature>`: screens and feature-only components.
- `/design-system`: live gallery of tokens, components and states.

## Rules

1. Colours, radius and shadows come from tokens. Raw colour classes fail lint.
2. Variants are defined with `cva` in the component file; do not restyle from outside.
3. Edit `components/ui` only for system-wide changes and record them in `CHANGELOG.md`.
4. Import patterns first, `components/ui` second, never the primitive library.
5. Switch layouts with `md:` and `lg:` classes; use `useMediaQuery` only inside patterns.
6. One component per file, kebab-case file names, PascalCase exports.

## Building a screen

1. Create `src/features/<feature>/<feature>-page.tsx` and add its route in `src/router.tsx`.
2. Add a nav item in `src/lib/navigation.ts` if it is a top-level screen (maximum five).
3. Start the page with `<div className="space-y-6">` and a `PageHeader`.
4. Lists use `DataList`; forms use `FormSection`, `TextField` and `FormActions`.
5. Create and edit flows open in `ResponsiveDialog`; destructive actions go through `ConfirmDialog`.
6. Handle loading, empty and error with `LoadingState`, `EmptyState` and `ErrorState`.
7. Add the route to `ROUTES` in `e2e/a11y.spec.ts` and `e2e/layout.spec.ts`.

## Adding a shadcn/ui component

1. Run `pnpm dlx shadcn@latest add <name>`.
2. Show it on `/design-system`.
3. Record any edit to the generated file in `CHANGELOG.md`.

## Changing the brand colour

Edit `--primary`, `--ring`, `--sidebar-primary` and `--sidebar-ring` in `:root` and `.dark`, then run `pnpm test:e2e` to confirm contrast still passes.
```

Replace `README.md`:

```md
# My App

React app built with Vite, Tailwind CSS and shadcn/ui.

## Commands

- `pnpm dev`: start the dev server
- `pnpm build`: type-check and build
- `pnpm test`: unit tests
- `pnpm test:e2e`: accessibility, layout and flow tests at phone, tablet and desktop sizes
- `pnpm lint` and `pnpm format`: lint and format

## Design system

See `docs/design-system.md` and the live gallery at `/design-system`.
```

Checks: `pnpm format:check` exits 0.

Commit: `docs: add design system guide, PR checklist and readme`

## Definition of done

The build is complete only when every item below is true; report each one as pass or fail
with the command output.

1. Eight commits exist, one per step, with the given messages.
2. `pnpm install --frozen-lockfile` succeeds on a clean clone.
3. `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` exit 0.
4. `pnpm test:e2e` passes in the phone, tablet and desktop projects.
5. The CI workflow is green on the default branch.
6. `package.json` contains no dependency that this spec did not name or the shadcn CLI did
   not add.
7. `src/components/ui` contains only files the shadcn CLI generated, plus `button.test.tsx`.
8. `src/components/patterns` contains exactly nine files: app-shell, confirm-dialog,
   data-list, form-section, page-header, responsive-dialog, responsive-menu, state-views,
   theme-toggle.
9. No raw colour class or hex value exists outside `src/styles/globals.css`.
10. The five routes render in light and dark themes, and the theme choice survives a reload.
11. `CHANGELOG.md` lists every edit to `components/ui` and every spec deviation.
12. The final report lists the installed versions of react, vite, tailwindcss, shadcn,
    react-router, react-hook-form, zod, vitest and @playwright/test.

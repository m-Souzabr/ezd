## What changed

## Design system checklist

Delete the section if the change touches no screen.

- [ ] Uses only semantic token classes; no raw colors or hex values
- [ ] Uses patterns from `components/patterns` before `components/ui`
- [ ] New or changed variants are defined with `cva` inside the component file
- [ ] Works at 375, 768 and 1280 px with no horizontal scroll
- [ ] Works in light and dark themes
- [ ] Every control is keyboard operable and has an accessible name
- [ ] Touch targets are at least 44 px
- [ ] New components and states are shown on `/design-system`
- [ ] Changes to `components/ui` are recorded in `apps/web/CHANGELOG.md`
- [ ] `pnpm format:check`, `typecheck`, `lint`, `test`, `build` and `pnpm --filter @ezd/web e2e` pass

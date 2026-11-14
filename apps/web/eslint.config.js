import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

import { base } from '../../eslint.config.js';

// `public/` holds plain browser scripts (the pre-paint theme script), not app source.
const browserScripts = { ignores: ['public/**'] };

const documentRules = [
  {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='doc']",
    message: "Do not assign to `doc`. Change the document with the store's execute, undo or redo.",
  },
  {
    selector: "CallExpression[callee.property.name='setState']",
    message:
      "Do not set the design store's state directly. Use its actions; the document changes only through execute, undo and redo.",
  },
];

const RAW_COLOR =
  '\\b(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|shadow|placeholder)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(-\\d{2,3})?\\b';
const colorMessage =
  'Use a semantic token class (bg-primary, text-muted-foreground, ...) instead of a raw color.';
const colorRules = [
  { selector: `Literal[value=/${RAW_COLOR}/]`, message: colorMessage },
  { selector: `TemplateElement[value.raw=/${RAW_COLOR}/]`, message: colorMessage },
];

export default [
  browserScripts,
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // shadcn writes components/ui; it exports variants next to components.
  { files: ['src/components/ui/**'], rules: { 'react-refresh/only-export-components': 'off' } },
  // The document changes only through core. The store's `execute`, `undo` and `redo` are
  // the one place that replaces `doc`, so nothing else may assign to it or set the store's
  // state directly.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/store/designStore.ts'],
    rules: { 'no-restricted-syntax': ['error', ...documentRules] },
  },
  // Design system: every screen uses semantic token classes, never a raw color class or a hex
  // value. Not UI colors, and so excepted: `components/ui` (generated), tests, the canvas
  // (a light drawing sheet in any theme, its colors from `editor/style.ts`), `logo.ts` (fills the
  // white background of a logo drawn onto a canvas) and `FinishesTab` (writes the default swatch
  // value, data, of a finish).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/components/ui/**',
      'src/**/*.test.{ts,tsx}',
      'src/test/**',
      'src/editor/style.ts',
      'src/editor/draw.tsx',
      'src/editor/CanvasHost.tsx',
      'src/editor/capture.tsx',
      'src/editor/plan/**',
      'src/editor/elevation/**',
      'src/admin/logo.ts',
      'src/admin/catalog/FinishesTab.tsx',
    ],
    rules: { 'no-restricted-syntax': ['error', ...colorRules] },
  },
  // The editor's chrome (header, toolbar, panels, dialogs, chat) is on the tokens too, so it
  // keeps both rules. The files that draw the canvas are the exception: the canvas is a light
  // drawing sheet in any theme, and its colors come from `editor/style.ts`, which the Control
  // Panel's theme sets, not from the design system's tokens.
  {
    files: ['src/editor/**/*.{ts,tsx}', 'src/quotes/**/*.{ts,tsx}', 'src/pages/DesignEditor.tsx'],
    ignores: [
      'src/editor/style.ts',
      'src/editor/draw.tsx',
      'src/editor/CanvasHost.tsx',
      'src/editor/capture.tsx',
      'src/editor/plan/**',
      'src/editor/elevation/**',
    ],
    rules: { 'no-restricted-syntax': ['error', ...documentRules, ...colorRules] },
  },
  {
    files: ['e2e/**/*.ts', 'perf/**/*.ts', 'playwright*.config.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
];

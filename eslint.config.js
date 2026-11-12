import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Shared by every workspace package: each package's eslint.config.js spreads `base`
// and adds its own rules.
export const base = tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);

// Root files only (packages lint themselves through `pnpm -r run lint`).
export default [
  ...base,
  { ignores: ['packages/**', 'apps/**'] },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
];

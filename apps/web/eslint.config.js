import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

import { base } from '../../eslint.config.js';

export default [
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
  // The document changes only through core. The store's `execute`, `undo` and `redo` are
  // the one place that replaces `doc`, so nothing else may assign to it or set the store's
  // state directly.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/store/designStore.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='doc']",
          message:
            "Do not assign to `doc`. Change the document with the store's execute, undo or redo.",
        },
        {
          selector: "CallExpression[callee.property.name='setState']",
          message:
            "Do not set the design store's state directly. Use its actions; the document changes only through execute, undo and redo.",
        },
      ],
    },
  },
  {
    files: ['e2e/**/*.ts', 'perf/**/*.ts', 'playwright*.config.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
];

import { base } from '../../eslint.config.js';

const message =
  '@ezd/core is pure TypeScript: no React, no Three.js, no Konva, no DOM and no Node-only APIs.';

export default [
  ...base,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['react', 'react-dom', 'three', 'konva', 'fs', 'path'].map((name) => ({
            name,
            message,
          })),
          patterns: [
            {
              group: [
                'react/*',
                'react-dom/*',
                'three/*',
                'konva/*',
                '@react-three/*',
                'node:*',
                'fs/*',
                'path/*',
              ],
              message,
            },
          ],
        },
      ],
    },
  },
];

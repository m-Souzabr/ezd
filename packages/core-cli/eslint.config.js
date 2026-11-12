import globals from 'globals';

import { base } from '../../eslint.config.js';

export default [...base, { languageOptions: { globals: globals.node } }];

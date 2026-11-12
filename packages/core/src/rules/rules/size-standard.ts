import { catalogFindings } from '../helpers.js';
import { defineRule } from '../types.js';

/** A height or depth that is not one of the standard values for the catalog entry. */
export const sizeStandard = defineRule('size.standard', 'error', (ctx) =>
  catalogFindings(ctx, ['HEIGHT_NOT_STANDARD', 'DEPTH_NOT_STANDARD']),
);

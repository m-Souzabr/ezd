import { catalogFindings } from '../helpers.js';
import { defineRule } from '../types.js';

/**
 * Everything else `checkItemAgainstCatalog` reports: an entry the catalog does not have,
 * the wrong kind, an option the entry does not take, or a placement it does not allow.
 */
export const itemCatalog = defineRule('item.catalog', 'error', (ctx) =>
  catalogFindings(ctx, [
    'UNKNOWN_CATALOG_ID',
    'KIND_MISMATCH',
    'OPTION_INVALID',
    'PLACEMENT_NOT_ALLOWED',
  ]),
);

import { describe, expect, it } from 'vitest';

import { SEED_CATALOG } from '../catalog/index.js';
import { kitchen, on, WALL_IDS } from '../test/kitchen.js';
import { inches } from '../units/index.js';
import { computeBom } from './bom.js';
import { bomToCsv, finishName, formatQuantity } from './csv.js';

const [NORTH] = WALL_IDS;

describe('bomToCsv', () => {
  it('writes a header and one row per line, with lengths in inches and fractions', () => {
    const doc = kitchen(
      [
        on('base.standard', NORTH, 0),
        on('base.standard', NORTH, 30),
        on('filler.base', NORTH, 60, { width: inches(1.5) }),
      ],
      {
        countertops: [
          {
            wallId: NORTH,
            startOffset: 0,
            endOffset: inches(97.5),
            depth: inches(25.5),
            thickness: inches(1.5),
            elevation: inches(34.5),
          },
        ],
      },
    );

    expect(bomToCsv(computeBom(doc, SEED_CATALOG), SEED_CATALOG)).toBe(
      [
        'Qty,Unit,Description,Width,Height,Depth,Finish,Unit price,Line total',
        '2,each,"Base cabinet, 2 doors, top drawer, hinge left","30""","34 1/2""","24""",White,$325.00,$650.00',
        '1,each,Base filler,"1 1/2""","34 1/2""","3/4""",White,$25.00,$25.00',
        '17.27,sqft,"Countertop, White stone","97 1/2""","1 1/2""","25 1/2""",White stone,$65.00,"$1,122.55"',
        '',
      ].join('\r\n'),
    );
  });

  it('is only the header for an empty bill', () => {
    expect(bomToCsv([], SEED_CATALOG)).toBe(
      'Qty,Unit,Description,Width,Height,Depth,Finish,Unit price,Line total\r\n',
    );
  });
});

describe('formatQuantity', () => {
  it('shows pieces as they are and square feet with two decimals', () => {
    expect(formatQuantity({ quantity: 3, unit: 'each' })).toBe('3');
    expect(formatQuantity({ quantity: 1727, unit: 'sqft' })).toBe('17.27');
    expect(formatQuantity({ quantity: 800, unit: 'sqft' })).toBe('8.00');
    expect(formatQuantity({ quantity: 5, unit: 'sqft' })).toBe('0.05');
  });
});

describe('finishName', () => {
  it('names a catalog finish, and falls back to the id or nothing', () => {
    expect(finishName(SEED_CATALOG, 'cabinet.oak')).toBe('Natural oak');
    expect(finishName(SEED_CATALOG, 'cabinet.gone')).toBe('cabinet.gone');
    expect(finishName(SEED_CATALOG, null)).toBe('');
  });
});

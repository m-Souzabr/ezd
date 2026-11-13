import { describe, expect, it } from 'vitest';

import { apply, room, seedItem, WALLS } from '../test/kitchen';
import { elevationGhosts, previewGhosts } from './preview';

const [A, B] = WALLS;

describe('previewGhosts', () => {
  const doc = room(144, 120, seedItem('item-000001', 'base.standard', A, 0));

  it('is empty when nothing differs', () => {
    expect(previewGhosts(doc, doc)).toEqual({ added: [], removed: [] });
  });

  it('shows added items, removed items, and a moved item in both lists', () => {
    const next = apply(
      doc,
      { type: 'item.add', item: seedItem('item-000002', 'base.standard', A, 30) },
      {
        type: 'item.move',
        id: 'item-000001',
        placement: { type: 'wall', wallId: B, offset: 0 },
      },
    );
    const ghosts = previewGhosts(doc, next);
    expect(ghosts.added.map((item) => item.id)).toEqual(['item-000001', 'item-000002']);
    expect(ghosts.removed.map((item) => item.id)).toEqual(['item-000001']);

    // Per wall, as the elevations draw them.
    const onA = elevationGhosts(ghosts, A);
    expect(onA.added.map((ghost) => ghost.id)).toEqual(['item-000002']);
    expect(onA.removed).toEqual([
      {
        id: 'item-000001',
        code: expect.any(String) as string,
        rect: { x: 0, y: 0, w: 480, h: 552 },
      },
    ]);
    expect(elevationGhosts(ghosts, B).added.map((ghost) => ghost.id)).toEqual(['item-000001']);
  });

  it('shows a removed item in red only', () => {
    const next = apply(doc, { type: 'item.remove', id: 'item-000001' });
    expect(previewGhosts(doc, next)).toEqual({ added: [], removed: doc.items });
  });
});

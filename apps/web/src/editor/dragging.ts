import {
  type Catalog,
  type Command,
  type DesignDocument,
  type Item,
  type Len,
  type Point,
  type Pt,
  type RulesConfig,
  snap,
  snapResize,
  type SnapResult,
  validateCommand,
} from '@ezd/core';

import { resizeCommand } from './edits';

/**
 * A drag in progress: the transient ghost, which is not in the document. `item` is the
 * item as it was when the drag started. `snap` is where the ghost is now, or null while
 * the pointer is outside the canvas, where a drop does nothing.
 */
export type Drag =
  | { kind: 'add'; item: Item; snap: SnapResult | null }
  | {
      kind: 'move';
      item: Item;
      /** From the point `snap` positions (the middle of the item) to where it was grabbed. */
      grab: Pt;
      snap: SnapResult | null;
    }
  | {
      kind: 'resize';
      item: Item;
      edge: 'left' | 'right';
      /** The ghost's width. */
      width: Len;
      snap: SnapResult | null;
    };

export type DragUpdate = { snap: SnapResult | null; width?: Len };

/** Where the ghost goes for a pointer in plan, and what dropping it there would break. */
export function snapDrag(
  doc: DesignDocument,
  catalog: Catalog,
  drag: Drag,
  pointer: Point,
  rules?: RulesConfig,
): DragUpdate {
  const { item } = drag;
  if (drag.kind !== 'resize') {
    return {
      snap: snap({
        doc,
        catalog,
        item,
        pointer,
        rules,
        ...(drag.kind === 'move' && { excludeItemId: item.id }),
      }),
    };
  }
  const { width, placement } = snapResize(doc, catalog, item, drag.edge, pointer);
  const command = resizeCommand(catalog, item, width, placement);
  const checked = command ? validateCommand(doc, catalog, command, rules) : null;
  return {
    width,
    snap: {
      placement,
      elevation: item.elevation,
      guides: [],
      introduced: checked?.ok ? checked.value.introduced : [],
    },
  };
}

/** The item as the ghost shows it, or null while the pointer is outside the canvas. */
export function dragGhost(drag: Drag): Item | null {
  if (!drag.snap) return null;
  return {
    ...drag.item,
    ...(drag.kind === 'resize' && { width: drag.width }),
    placement: drag.snap.placement,
    elevation: drag.snap.elevation,
  };
}

/** Whether dropping now would introduce an error, which turns the ghost red. */
export const dragHasError = (drag: Drag): boolean =>
  drag.snap?.introduced.some((violation) => violation.severity === 'error') ?? false;

/** The one command a drop executes, or null when the drop changes nothing. */
export function dragCommand(catalog: Catalog, drag: Drag): Command | null {
  const { item, snap: snapped } = drag;
  if (!snapped) return null;
  const { placement, elevation } = snapped;
  switch (drag.kind) {
    case 'add':
      return { type: 'item.add', item: { ...item, placement, elevation } };
    case 'move': {
      const unmoved =
        elevation === item.elevation &&
        JSON.stringify(placement) === JSON.stringify(item.placement);
      return unmoved ? null : { type: 'item.move', id: item.id, placement, elevation };
    }
    case 'resize':
      return resizeCommand(catalog, item, drag.width, placement);
  }
}

import {
  type DesignDocument,
  type Id,
  IN,
  type Item,
  pointOnWall,
  type Pt,
  wallLabel,
} from '@ezd/core';
import { useMemo } from 'react';
import { Group, Layer, Line, Rect, Stage } from 'react-konva';

import { useDesign, useDesignStore } from '../../store/context';
import { severityById } from '../../store/selectors';
import { CanvasHost, type CanvasPointer } from '../CanvasHost';
import { CenteredText } from '../draw';
import { type Drag, dragGhost, dragHasError } from '../dragging';
import { itemCode } from '../labels';
import { elevationGhosts, previewGhosts } from '../preview';
import { COLORS } from '../style';
import { wallOf } from '../tools/select';
import { box } from './box';
import { ElevationDrawing } from './ElevationDrawing';
import { elevationItemAt, elevationModel } from './model';

const thin = { strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;

/**
 * One wall seen from inside the room: x is the offset along the wall from its left end,
 * y the height above the floor. It draws from the same document as the plan, and dragging
 * an item sideways moves it along this wall with the same snapping.
 */
export function ElevationCanvas({
  wallId,
  previewDoc,
}: {
  wallId: Id;
  /** A pending proposal: the items that differ from the document are drawn as ghosts. */
  previewDoc?: DesignDocument | undefined;
}) {
  const store = useDesignStore();
  const doc = useDesign((state) => state.doc);
  const catalog = useDesign((state) => state.catalog);
  const violations = useDesign((state) => state.violations);
  const selection = useDesign((state) => state.selection);
  const drag = useDesign((state) => state.drag);

  const model = useMemo(() => elevationModel(doc, catalog, wallId), [doc, catalog, wallId]);
  const severities = useMemo(() => severityById(violations), [violations]);
  const ghosts = useMemo(
    () => (previewDoc ? elevationGhosts(previewGhosts(doc, previewDoc), wallId) : null),
    [doc, previewDoc, wallId],
  );
  if (!model) return null;

  const onPress = ({ point }: CanvasPointer): Drag | null => {
    const state = store.getState();
    if (state.tool !== 'select') return null;
    const x = point.x;
    const y = -point.y;
    const hit = elevationItemAt(model, x, y);
    if (hit) {
      state.select([hit.id]);
      return {
        kind: 'move',
        item: hit.item,
        grab: { x: x - (hit.rect.x + hit.rect.w / 2), y: 0 },
        snap: null,
      };
    }
    const opening = model.openings.find(
      ({ rect }) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h,
    );
    state.select(opening ? [opening.id] : []);
    return null;
  };

  /**
   * The plan pointer for a drag here: a point on this wall's face, kept half the item's
   * width from each end so no other wall is nearer and `snap` stays on this wall.
   */
  const dragPointer = (current: Drag, point: Pt) => {
    const wall = wallOf(store.getState().doc, wallId);
    if (!wall) return null;
    const half = Math.min(current.item.width, model.length) / 2;
    const along =
      current.kind === 'resize'
        ? point.x
        : Math.min(Math.max(point.x, half), Math.max(half, model.length - half));
    return pointOnWall(wall, along);
  };

  const ghost: Item | null = drag ? dragGhost(drag) : null;
  const ghostHere =
    ghost?.placement.type === 'wall' && ghost.placement.wallId === wallId ? ghost : null;
  const blocked = drag ? dragHasError(drag) : false;
  const draggedId = drag && drag.kind !== 'add' ? drag.item.id : undefined;

  return (
    <CanvasHost
      label={`Elevation of wall ${wallLabel(doc, wallId)}. Tab steps through the items, left and right arrow keys move the selected item, Delete removes it.`}
      onPress={onPress}
      dragPointer={dragPointer}
    >
      {(size, viewport) => (
        <Stage width={size.width} height={size.height} listening={false}>
          <Layer
            x={viewport.offsetX}
            y={viewport.offsetY}
            scaleX={viewport.scale / IN}
            scaleY={viewport.scale / IN}
            listening={false}
          >
            <ElevationDrawing
              model={model}
              selection={selection}
              severities={severities}
              draggedId={draggedId}
              dragging={drag !== null}
              viewport={viewport}
            />
          </Layer>
          <Layer
            x={viewport.offsetX}
            y={viewport.offsetY}
            scaleX={viewport.scale / IN}
            scaleY={viewport.scale / IN}
            listening={false}
          >
            {ghosts &&
              [
                ...ghosts.removed.map((ghost) => ({ ghost, added: false })),
                ...ghosts.added.map((ghost) => ({ ghost, added: true })),
              ].map(({ ghost, added }) => (
                <Group key={`${added ? 'add' : 'remove'}-${ghost.id}`}>
                  <Rect
                    {...box(ghost.rect)}
                    fill={added ? COLORS.proposalAdded : COLORS.proposalRemoved}
                    stroke={added ? COLORS.proposalAddedLine : COLORS.proposalRemovedLine}
                    dash={added ? [] : [6, 4]}
                    {...thin}
                    strokeWidth={2}
                  />
                  {added && (
                    <CenteredText
                      at={{
                        x: ghost.rect.x + ghost.rect.w / 2,
                        y: -(ghost.rect.y + ghost.rect.h / 2),
                      }}
                      text={ghost.code}
                      fill={COLORS.proposalAddedLine}
                      bold
                      viewport={viewport}
                    />
                  )}
                </Group>
              ))}
            {ghostHere && ghostHere.placement.type === 'wall' && (
              <Group>
                <Rect
                  {...box({
                    x: ghostHere.placement.offset,
                    y: ghostHere.elevation,
                    w: ghostHere.width,
                    h: ghostHere.height,
                  })}
                  fill={blocked ? COLORS.ghostError : COLORS.ghost}
                  stroke={blocked ? COLORS.error : COLORS.selection}
                  {...thin}
                  strokeWidth={2}
                />
                <CenteredText
                  at={{
                    x: ghostHere.placement.offset + ghostHere.width / 2,
                    y: -(ghostHere.elevation + ghostHere.height / 2),
                  }}
                  text={itemCode(ghostHere)}
                  fill={blocked ? COLORS.error : COLORS.selection}
                  bold
                  viewport={viewport}
                />
                {/* Snap guides run into the room in plan; here each is a vertical line. */}
                {(drag?.snap?.guides ?? []).map((guide, i) => {
                  const wall = wallOf(doc, wallId);
                  if (!wall) return null;
                  const dx = guide.from.x - wall.start.x;
                  const dy = guide.from.y - wall.start.y;
                  const along = Math.round(Math.hypot(dx, dy));
                  return (
                    <Line
                      key={i}
                      points={[along, 0, along, -model.height]}
                      stroke={COLORS.guide}
                      dash={[5, 3]}
                      {...thin}
                      strokeWidth={1.5}
                    />
                  );
                })}
              </Group>
            )}
          </Layer>
        </Stage>
      )}
    </CanvasHost>
  );
}

import { type Id, IN, type Item, pointOnWall, type Pt, wallLabel } from '@ezd/core';
import { useMemo } from 'react';
import { Group, Layer, Line, Rect, Stage } from 'react-konva';

import { useDesign, useDesignStore } from '../../store/context';
import { severityById } from '../../store/selectors';
import { CanvasHost, type CanvasPointer } from '../CanvasHost';
import { CenteredText, DimensionLine } from '../draw';
import { type Drag, dragGhost, dragHasError } from '../dragging';
import { itemCode } from '../labels';
import { COLORS, ITEM_FILL, severityColor } from '../style';
import { wallOf } from '../tools/select';
import {
  type DimensionSegment,
  elevationItemAt,
  elevationModel,
  type ElevationRect,
} from './model';

const thin = { strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;
const UP: Pt = { x: 0, y: -1 };
const DOWN: Pt = { x: 0, y: 1 };

/** A rectangle given by its left and bottom, on a drawing whose y axis points down. */
const box = (rect: ElevationRect) => ({
  x: rect.x,
  y: -(rect.y + rect.h),
  width: rect.w,
  height: rect.h,
});

function DimensionString({
  segments,
  y,
  away,
  viewport,
}: {
  segments: readonly DimensionSegment[];
  /** The drawing y of the line the string measures. */
  y: number;
  away: Pt;
  viewport: Parameters<typeof DimensionLine>[0]['viewport'];
}) {
  return (
    <>
      {segments.map((segment, i) => (
        <DimensionLine
          key={i}
          from={{ x: segment.from, y }}
          to={{ x: segment.to, y }}
          away={away}
          text={segment.text}
          offset={16}
          color={segment.kind === 'item' ? COLORS.label : COLORS.dimension}
          viewport={viewport}
        />
      ))}
    </>
  );
}

/**
 * One wall seen from inside the room: x is the offset along the wall from its left end,
 * y the height above the floor. It draws from the same document as the plan, and dragging
 * an item sideways moves it along this wall with the same snapping.
 */
export function ElevationCanvas({ wallId }: { wallId: Id }) {
  const store = useDesignStore();
  const doc = useDesign((state) => state.doc);
  const catalog = useDesign((state) => state.catalog);
  const violations = useDesign((state) => state.violations);
  const selection = useDesign((state) => state.selection);
  const drag = useDesign((state) => state.drag);

  const model = useMemo(() => elevationModel(doc, catalog, wallId), [doc, catalog, wallId]);
  const severities = useMemo(() => severityById(violations), [violations]);
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
            {/* The wall, with the ceiling line along its top and the floor line below. */}
            <Rect
              {...box({ x: 0, y: 0, w: model.length, h: model.height })}
              fill={COLORS.floor}
              stroke={COLORS.wall}
              {...thin}
            />
            <Line
              points={[0, -model.height, model.length, -model.height]}
              stroke={COLORS.wall}
              {...thin}
              strokeWidth={2}
            />
            <Line points={[0, 0, model.length, 0]} stroke={COLORS.wall} {...thin} strokeWidth={3} />

            {model.openings.map((opening) => (
              <Group key={opening.id}>
                <Rect
                  {...box(opening.rect)}
                  fill={COLORS.opening}
                  stroke={selection.includes(opening.id) ? COLORS.selection : COLORS.openingLine}
                  {...thin}
                  strokeWidth={selection.includes(opening.id) ? 2 : 1}
                />
                {opening.kind === 'window' && (
                  <Line
                    points={[
                      opening.rect.x + opening.rect.w / 2,
                      -opening.rect.y,
                      opening.rect.x + opening.rect.w / 2,
                      -(opening.rect.y + opening.rect.h),
                    ]}
                    stroke={COLORS.openingLine}
                    {...thin}
                  />
                )}
              </Group>
            ))}

            {model.backsplash.map((rect, i) => (
              <Rect key={i} {...box(rect)} fill={COLORS.backsplash} listening={false} />
            ))}
            {model.adjacent.map(({ id, rect }) => (
              <Rect
                key={id}
                {...box(rect)}
                stroke={COLORS.countertopLine}
                dash={[4, 4]}
                {...thin}
              />
            ))}

            {model.items.map(({ id, item, rect, fronts, code }) => {
              const flagged = severityColor(severities.get(id));
              const selected = selection.includes(id);
              return (
                <Group key={id} opacity={id === draggedId ? 0.3 : 1}>
                  <Rect
                    {...box(rect)}
                    fill={ITEM_FILL[item.kind]}
                    stroke={flagged ?? COLORS.itemLine}
                    {...thin}
                    strokeWidth={flagged ? 2.5 : 1}
                  />
                  {fronts.map((front, i) => (
                    <Rect
                      key={i}
                      {...box(front.rect)}
                      fill={front.role === 'toe-kick' ? '#cbd5e1' : 'rgba(255, 255, 255, 0.55)'}
                      stroke={COLORS.itemLine}
                      {...thin}
                      strokeWidth={0.75}
                    />
                  ))}
                  {(rect.w / IN) * viewport.scale >= 26 && (
                    <CenteredText
                      at={{ x: rect.x + rect.w / 2, y: -(rect.y + rect.h / 2) }}
                      text={code}
                      viewport={viewport}
                    />
                  )}
                  {selected && !drag && (
                    <Rect
                      {...box(rect)}
                      stroke={COLORS.selection}
                      dash={[7, 4]}
                      {...thin}
                      strokeWidth={2}
                    />
                  )}
                </Group>
              );
            })}

            {model.countertops.map(({ id, rect }) => (
              <Rect
                key={id}
                {...box(rect)}
                fill="#94a3b8"
                stroke={selection.includes(id) ? COLORS.selection : COLORS.itemLine}
                {...thin}
              />
            ))}

            <DimensionString
              segments={model.dimensions.bottom}
              y={0}
              away={DOWN}
              viewport={viewport}
            />
            <DimensionString
              segments={model.dimensions.top}
              y={-model.height}
              away={UP}
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

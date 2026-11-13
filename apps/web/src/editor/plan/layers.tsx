import {
  type Catalog,
  type DesignDocument,
  type Id,
  IN,
  isClosedLoop,
  type Item,
  itemFootprint,
  type Point,
  type Pt,
  type Severity,
  type SnapGuide,
} from '@ezd/core';
import type Konva from 'konva';
import { Circle, Group, Line, Rect, Shape } from 'react-konva';

import { CenteredText, DimensionLine } from '../draw';
import { itemCode } from '../labels';
import { COLORS, flat, ITEM_FILL, severityColor } from '../style';
import {
  countertopFootprint,
  findTarget,
  isResizable,
  resizeHandles,
  wallOf,
} from '../tools/select';
import { type Bounds, gridStep, pixels, type Viewport } from '../viewport';
import type { PreviewGhosts } from '../preview';
import { itemDimensions, openingSymbol, wallDimensions, wallPolygon } from './model';

// The plan's layers, bottom to top: grid, floor, walls, openings, countertops, items,
// dimensions, snap guides, selection handles, drag ghost. Each is a group of shapes in
// plan units; nothing here listens for events, because the canvas does its own hit tests.

const thin = { strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;
/** Past this many lines the grid is too fine to see, so it is not drawn. */
const MAX_GRID_LINES = 400;

function gridLines(ctx: Konva.Context, bounds: Bounds, step: number) {
  const startX = Math.floor(bounds.minX / step) * step;
  const startY = Math.floor(bounds.minY / step) * step;
  if ((bounds.maxX - startX) / step + (bounds.maxY - startY) / step > MAX_GRID_LINES) return;
  ctx.beginPath();
  for (let x = startX; x <= bounds.maxX; x += step) {
    ctx.moveTo(x, bounds.minY);
    ctx.lineTo(x, bounds.maxY);
  }
  for (let y = startY; y <= bounds.maxY; y += step) {
    ctx.moveTo(bounds.minX, y);
    ctx.lineTo(bounds.maxX, y);
  }
}

/** Lines every 3 in when zoomed in and every 12 in when zoomed out, heavier every fourth. */
export function GridLayer({ viewport, visible }: { viewport: Viewport; visible: Bounds }) {
  const step = gridStep(viewport);
  return (
    <Group>
      {[
        { every: step, stroke: COLORS.gridMinor },
        { every: step * 4, stroke: COLORS.gridMajor },
      ].map(({ every, stroke }) => (
        <Shape
          key={every}
          sceneFunc={(ctx, shape) => {
            gridLines(ctx, visible, every);
            ctx.strokeShape(shape);
          }}
          stroke={stroke}
          {...thin}
        />
      ))}
    </Group>
  );
}

export function FloorLayer({ doc }: { doc: DesignDocument }) {
  const { walls } = doc.room;
  if (!isClosedLoop(walls)) return null;
  return (
    <Line
      points={flat(walls.map((wall) => wall.start))}
      closed
      fill={COLORS.floor}
      listening={false}
    />
  );
}

export function WallsLayer({ doc }: { doc: DesignDocument }) {
  return (
    <Group>
      {doc.room.walls.map((wall) => (
        <Line
          key={wall.id}
          points={flat(wallPolygon(doc, wall))}
          closed
          fill={COLORS.wall}
          listening={false}
        />
      ))}
    </Group>
  );
}

/** Each opening as a gap in its wall, with a swing arc for a door or panes for a window. */
export function OpeningsLayer({ doc }: { doc: DesignDocument }) {
  return (
    <Group>
      {doc.room.openings.map((opening) => {
        const wall = wallOf(doc, opening.wallId);
        if (!wall) return null;
        const { gap, swing } = openingSymbol(wall, opening);
        const [a, b, c, d] = gap;
        const line = { stroke: COLORS.openingLine, ...thin };
        return (
          <Group key={opening.id}>
            <Line points={flat(gap)} closed fill={COLORS.opening} listening={false} />
            <Line points={flat([a, d])} {...line} />
            <Line points={flat([b, c])} {...line} />
            {opening.kind === 'window' && (
              <>
                <Line points={flat([a, b])} {...line} />
                <Line points={flat([d, c])} {...line} />
                <Line
                  points={flat([
                    { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 },
                    { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 },
                  ])}
                  {...line}
                />
              </>
            )}
            {opening.kind === 'passage' && <Line points={flat([a, b])} dash={[4, 4]} {...line} />}
            {swing && (
              <>
                <Line points={flat([swing.hinge, swing.open])} {...line} strokeWidth={2} />
                <Shape
                  sceneFunc={(ctx, shape) => {
                    const from = {
                      x: swing.closed.x - swing.hinge.x,
                      y: swing.closed.y - swing.hinge.y,
                    };
                    const to = { x: swing.open.x - swing.hinge.x, y: swing.open.y - swing.hinge.y };
                    ctx.beginPath();
                    ctx.arc(
                      swing.hinge.x,
                      swing.hinge.y,
                      swing.radius,
                      Math.atan2(from.y, from.x),
                      Math.atan2(to.y, to.x),
                      from.x * to.y - from.y * to.x < 0,
                    );
                    ctx.strokeShape(shape);
                  }}
                  dash={[3, 3]}
                  {...line}
                />
              </>
            )}
          </Group>
        );
      })}
    </Group>
  );
}

export function CountertopsLayer({ doc }: { doc: DesignDocument }) {
  return (
    <Group>
      {doc.countertops.map((countertop) => {
        const footprint = countertopFootprint(doc, countertop);
        return (
          footprint && (
            <Line
              key={countertop.id}
              points={flat(footprint)}
              closed
              fill={COLORS.countertop}
              stroke={COLORS.countertopLine}
              dash={[6, 3]}
              {...thin}
            />
          )
        );
      })}
    </Group>
  );
}

const centre = (points: readonly Pt[]): Pt => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

/** A label is drawn only when the item is at least this wide on screen, in pixels. */
const MIN_LABEL_WIDTH_PX = 26;

/**
 * Each item as its footprint, with its code and a heavy line along its front. Items hung
 * on the wall are dashed and drawn over the ones on the floor. An item with violations is
 * outlined red or amber.
 */
export function ItemsLayer({
  doc,
  severities,
  viewport,
  draggedId,
}: {
  doc: DesignDocument;
  severities: Map<Id, Severity>;
  viewport: Viewport;
  /** The item being moved or resized, which is faded while its ghost shows. */
  draggedId: Id | undefined;
}) {
  const items = [...doc.items].sort((a, b) => a.elevation - b.elevation);
  return (
    <Group>
      {items.map((item) => {
        const footprint = itemFootprint(doc, item);
        if (!footprint) return null;
        const flagged = severityColor(severities.get(item.id));
        const hung = item.elevation > 0;
        const [, , frontRight, frontLeft] = footprint;
        return (
          <Group key={item.id} opacity={item.id === draggedId ? 0.3 : 1}>
            <Line
              points={flat(footprint)}
              closed
              fill={ITEM_FILL[item.kind]}
              stroke={flagged ?? COLORS.itemLine}
              {...thin}
              strokeWidth={flagged ? 2.5 : 1}
              {...(hung && !flagged && { dash: [5, 3] })}
            />
            <Line
              points={flat([frontLeft, frontRight])}
              stroke={flagged ?? COLORS.itemLine}
              {...thin}
              strokeWidth={hung ? 2 : 3.5}
            />
            {(item.width / IN) * viewport.scale >= MIN_LABEL_WIDTH_PX && (
              <CenteredText at={centre(footprint)} text={itemCode(item)} viewport={viewport} />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** Wall lengths always; for the selected item, its width and the gaps beside it. */
export function DimensionsLayer({
  doc,
  selected,
  viewport,
}: {
  doc: DesignDocument;
  selected: Item | undefined;
  viewport: Viewport;
}) {
  return (
    <Group>
      {wallDimensions(doc).map((dimension, i) => (
        <DimensionLine key={i} {...dimension} offset={16} viewport={viewport} />
      ))}
      {selected &&
        itemDimensions(doc, selected).map((dimension, i) => (
          <DimensionLine
            key={`s${i}`}
            {...dimension}
            offset={14}
            color={COLORS.selection}
            viewport={viewport}
          />
        ))}
    </Group>
  );
}

export function GuidesLayer({ guides }: { guides: readonly SnapGuide[] }) {
  return (
    <Group>
      {guides.map((guide, i) => (
        <Line
          key={i}
          points={flat([guide.from, guide.to])}
          stroke={COLORS.guide}
          dash={[5, 3]}
          {...thin}
          strokeWidth={1.5}
        />
      ))}
    </Group>
  );
}

/** The outline of whatever is selected, and the resize handles of a selected item. */
export function SelectionLayer({
  doc,
  catalog,
  selection,
  handles,
  viewport,
}: {
  doc: DesignDocument;
  catalog: Catalog;
  selection: readonly Id[];
  /** Whether to draw resize handles, which only the select tool uses. */
  handles: boolean;
  viewport: Viewport;
}) {
  const size = pixels(viewport, 9);
  return (
    <Group>
      {selection.map((id) => {
        const target = findTarget(doc, id);
        if (!target) return null;
        let outline: Pt[] | null;
        switch (target.kind) {
          case 'item':
            outline = itemFootprint(doc, target.item);
            break;
          case 'countertop':
            outline = countertopFootprint(doc, target.countertop);
            break;
          case 'opening': {
            const wall = wallOf(doc, target.opening.wallId);
            outline = wall ? openingSymbol(wall, target.opening).gap : null;
            break;
          }
          case 'wall':
            outline = wallPolygon(doc, target.wall);
            break;
        }
        if (!outline) return null;
        const grips =
          handles &&
          selection.length === 1 &&
          target.kind === 'item' &&
          isResizable(target.item, catalog)
            ? resizeHandles(doc, target.item)
            : null;
        return (
          <Group key={id}>
            <Line
              points={flat(outline)}
              closed
              stroke={COLORS.selection}
              // Dashed, so the red or amber outline of an item with violations shows through.
              dash={[7, 4]}
              {...thin}
              strokeWidth={2}
            />
            {grips &&
              [grips.left, grips.right].map((grip, i) => (
                <Rect
                  key={i}
                  x={grip.x - size / 2}
                  y={grip.y - size / 2}
                  width={size}
                  height={size}
                  fill="#ffffff"
                  stroke={COLORS.selection}
                  {...thin}
                  strokeWidth={1.5}
                />
              ))}
          </Group>
        );
      })}
    </Group>
  );
}

/** The dragged item where it would land: blue, or red if dropping there breaks a rule. */
export function GhostLayer({
  doc,
  ghost,
  blocked,
  viewport,
}: {
  doc: DesignDocument;
  ghost: Item | null;
  blocked: boolean;
  viewport: Viewport;
}) {
  const footprint = ghost && itemFootprint(doc, ghost);
  if (!ghost || !footprint) return null;
  return (
    <Group>
      <Line
        points={flat(footprint)}
        closed
        fill={blocked ? COLORS.ghostError : COLORS.ghost}
        stroke={blocked ? COLORS.error : COLORS.selection}
        {...thin}
        strokeWidth={2}
      />
      <CenteredText
        at={centre(footprint)}
        text={itemCode(ghost)}
        fill={blocked ? COLORS.error : COLORS.selection}
        bold
        viewport={viewport}
      />
    </Group>
  );
}

/** A pending proposal: what it removes in red, under what it adds in green. */
export function ProposalLayer({
  doc,
  previewDoc,
  ghosts,
  viewport,
}: {
  doc: DesignDocument;
  previewDoc: DesignDocument;
  ghosts: PreviewGhosts;
  viewport: Viewport;
}) {
  const shapes = [
    ...ghosts.removed.map((item) => ({ item, from: doc, added: false })),
    ...ghosts.added.map((item) => ({ item, from: previewDoc, added: true })),
  ];
  return (
    <Group>
      {shapes.map(({ item, from, added }) => {
        const footprint = itemFootprint(from, item);
        if (!footprint) return null;
        const line = added ? COLORS.proposalAddedLine : COLORS.proposalRemovedLine;
        return (
          <Group key={`${added ? 'add' : 'remove'}-${item.id}`}>
            <Line
              points={flat(footprint)}
              closed
              fill={added ? COLORS.proposalAdded : COLORS.proposalRemoved}
              stroke={line}
              dash={added ? [] : [6, 4]}
              {...thin}
              strokeWidth={2}
            />
            {added && (
              <CenteredText
                at={centre(footprint)}
                text={itemCode(item)}
                fill={line}
                bold
                viewport={viewport}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** The walls being drawn: the points so far and the stretch to the pointer, with its length. */
export function WallDraftLayer({
  draft,
  cursor,
  lengthText,
  viewport,
}: {
  draft: readonly Point[];
  cursor: Point | null;
  /** The length of the stretch to the pointer, formatted. */
  lengthText: string | null;
  viewport: Viewport;
}) {
  const points = cursor ? [...draft, cursor] : draft;
  const last = draft.at(-1);
  return (
    <Group>
      <Line points={flat(points)} stroke={COLORS.selection} {...thin} strokeWidth={2} />
      {points.map((point, i) => (
        <Circle
          key={i}
          x={point.x}
          y={point.y}
          radius={pixels(viewport, 3.5)}
          fill="#ffffff"
          stroke={COLORS.selection}
          {...thin}
          strokeWidth={1.5}
        />
      ))}
      {last && cursor && lengthText && (
        <CenteredText
          at={{
            x: (last.x + cursor.x) / 2,
            y: (last.y + cursor.y) / 2 - pixels(viewport, 12),
          }}
          text={lengthText}
          fill={COLORS.selection}
          bold
          viewport={viewport}
        />
      )}
    </Group>
  );
}

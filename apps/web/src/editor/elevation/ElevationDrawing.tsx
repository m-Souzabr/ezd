import { type Id, IN, type Pt, type Severity } from '@ezd/core';
import { Group, Line, Rect } from 'react-konva';

import { CenteredText, DimensionLine } from '../draw';
import { COLORS, ITEM_FILL, severityColor } from '../style';
import type { Viewport } from '../viewport';
import { box } from './box';
import type { DimensionSegment, ElevationModel } from './model';

const thin = { strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;
const UP: Pt = { x: 0, y: -1 };
const DOWN: Pt = { x: 0, y: 1 };

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
 * The elevation of one wall, in drawing units: the wall, its openings, the items with
 * their fronts, the countertops and the dimension strings. Drawn by the editor's canvas,
 * and by the quote's drawings with nothing selected.
 */
export function ElevationDrawing({
  model,
  selection,
  severities,
  draggedId,
  dragging,
  viewport,
}: {
  model: ElevationModel;
  selection: readonly Id[];
  severities: Map<Id, Severity>;
  draggedId: Id | undefined;
  dragging: boolean;
  viewport: Viewport;
}) {
  return (
    <>
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
        <Rect key={id} {...box(rect)} stroke={COLORS.countertopLine} dash={[4, 4]} {...thin} />
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
            {selected && !dragging && (
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

      <DimensionString segments={model.dimensions.bottom} y={0} away={DOWN} viewport={viewport} />
      <DimensionString
        segments={model.dimensions.top}
        y={-model.height}
        away={UP}
        viewport={viewport}
      />
    </>
  );
}

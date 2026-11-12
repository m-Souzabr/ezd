import type { Pt } from '@ezd/core';
import { Line, Text } from 'react-konva';

import { COLORS } from './style';
import { pixels, type Viewport } from './viewport';

// Drawing pieces the plan and the elevation share. Shapes are in drawing units
// (sixteenths of an inch) inside a layer the viewport scales, so sizes that should stay
// the same on screen, such as text and line offsets, are converted with `pixels`.

const FONT = 'ui-sans-serif, system-ui, sans-serif';
const TEXT_BOX_PX = 220;

/** One line of text centred on a point, at a fixed size on screen. */
export function CenteredText({
  at,
  text,
  size = 11,
  fill = COLORS.label,
  bold = false,
  viewport,
}: {
  at: Pt;
  text: string;
  /** In pixels. */
  size?: number;
  fill?: string;
  bold?: boolean;
  viewport: Viewport;
}) {
  const fontSize = pixels(viewport, size);
  const width = pixels(viewport, TEXT_BOX_PX);
  return (
    <Text
      x={at.x}
      y={at.y}
      width={width}
      offsetX={width / 2}
      offsetY={fontSize / 2}
      align="center"
      text={text}
      fontSize={fontSize}
      fontFamily={FONT}
      fontStyle={bold ? 'bold' : 'normal'}
      fill={fill}
      listening={false}
    />
  );
}

/**
 * A dimension: a line between two points with a tick at each end and the length written
 * beside it, moved `offset` pixels along `away` from what it measures.
 */
export function DimensionLine({
  from,
  to,
  away,
  text,
  offset = 14,
  color = COLORS.dimension,
  viewport,
}: {
  from: Pt;
  to: Pt;
  away: Pt;
  text: string;
  /** In pixels. */
  offset?: number;
  color?: string;
  viewport: Viewport;
}) {
  const move = (p: Pt, px: number): Pt => {
    const d = pixels(viewport, px);
    return { x: p.x + away.x * d, y: p.y + away.y * d };
  };
  const a = move(from, offset);
  const b = move(to, offset);
  const tick = (p: Pt) => [move(p, -4), move(p, 4)].flatMap((q) => [q.x, q.y]);
  // Text is drawn level, so beside an upright line it needs room for half its width.
  const clearance = 9 + Math.abs(away.x) * text.length * 3;
  const middle = move({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, clearance);
  const line = { stroke: color, strokeWidth: 1, strokeScaleEnabled: false, listening: false };
  return (
    <>
      <Line points={[a.x, a.y, b.x, b.y]} {...line} />
      <Line points={tick(a)} {...line} />
      <Line points={tick(b)} {...line} />
      <CenteredText at={middle} text={text} size={10.5} fill={color} viewport={viewport} />
    </>
  );
}

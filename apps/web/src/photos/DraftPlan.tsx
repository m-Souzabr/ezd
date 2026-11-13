import { draftPreview, itemFootprint, pointOnWall, type RoomDraft, wallNormal } from '@ezd/core';
import { useMemo } from 'react';

// The live plan of the draft, drawn from core's `draftPreview`. A wall with no length yet
// is drawn at a placeholder length, dashed, and what cannot be placed is counted below.

const MARGIN = 40 * 16;

export function DraftPlan({ draft }: { draft: RoomDraft }) {
  const { doc, skipped } = useMemo(() => draftPreview(draft), [draft]);
  const points = doc.room.walls.flatMap((wall) => [wall.start, wall.end]);
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">Pick a shape to see the plan.</p>;
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - MARGIN;
  const minY = Math.min(...ys) - MARGIN;
  const width = Math.max(...xs) - Math.min(...xs) + 2 * MARGIN;
  const height = Math.max(...ys) - Math.min(...ys) + 2 * MARGIN;
  const known = (index: number) => draft.walls[index]?.length.value != null;

  return (
    <figure className="flex flex-col gap-1">
      <svg
        role="img"
        aria-label="Plan of the draft room"
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="h-64 w-full rounded border border-slate-200 bg-white"
      >
        {doc.items.map((item) => {
          const footprint = itemFootprint(doc, item);
          if (!footprint) return null;
          return (
            <polygon
              key={item.id}
              points={footprint.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={item.kind === 'wall' ? '#e0f2fe' : '#f1f5f9'}
              stroke="#475569"
              strokeWidth={8}
              opacity={item.kind === 'wall' ? 0.7 : 1}
            />
          );
        })}
        {doc.room.walls.map((wall, index) => {
          const middle = pointOnWall(
            wall,
            Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / 2,
          );
          const normal = wallNormal(wall);
          return (
            <g key={wall.id}>
              <line
                x1={wall.start.x}
                y1={wall.start.y}
                x2={wall.end.x}
                y2={wall.end.y}
                stroke="#0f172a"
                strokeWidth={wall.thickness}
                strokeDasharray={known(index) ? undefined : '64 48'}
              />
              <text
                x={middle.x - normal.x * 200}
                y={middle.y - normal.y * 200}
                fontSize={160}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#0f172a"
              >
                {String.fromCharCode(65 + index)}
              </text>
            </g>
          );
        })}
        {doc.room.openings.map((opening) => {
          const wall = doc.room.walls.find((w) => w.id === opening.wallId)!;
          const a = pointOnWall(wall, opening.offset);
          const b = pointOnWall(wall, opening.offset + opening.width);
          return (
            <line
              key={opening.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={opening.kind === 'window' ? '#0284c7' : '#b45309'}
              strokeWidth={wall.thickness + 16}
            />
          );
        })}
      </svg>
      <figcaption className="text-xs text-slate-500">
        Dashed walls have no length yet.
        {skipped > 0 &&
          ` ${skipped} ${skipped === 1 ? 'thing is' : 'things are'} not drawn until placed on a wall that has room for it.`}
      </figcaption>
    </figure>
  );
}

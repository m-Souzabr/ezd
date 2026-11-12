import { describe, expect, it } from 'vitest';

import {
  distancePointToSegment,
  distancePointToWall,
  distanceRectToRect,
  distanceRectToSegment,
  EPS,
  type Footprint,
  isClosedLoop,
  pointInPolygon,
  rectsOverlap,
  segmentCrossesRect,
} from './index.js';

/** An axis-aligned rectangle, turned by `degrees` about its back left corner. */
function rect(x: number, y: number, width: number, depth: number, degrees = 0): Footprint {
  const angle = (degrees * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const into = { x: -along.y, y: along.x };
  const at = (u: number, v: number) => ({
    x: x + along.x * u + into.x * v,
    y: y + along.y * u + into.y * v,
  });
  return [at(0, 0), at(width, 0), at(width, depth), at(0, depth)];
}

describe('rectsOverlap', () => {
  it('is true for rectangles that share area', () => {
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true);
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(20, 20, 10, 10))).toBe(true);
  });

  it('is false for rectangles apart on either axis', () => {
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(200, 0, 100, 100))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(0, 200, 100, 100))).toBe(false);
  });

  it('does not count touching edges or corners', () => {
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(100, 100, 100, 100))).toBe(false);
    // Within the tolerance of touching.
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(100 - EPS, 0, 100, 100))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(99, 0, 100, 100))).toBe(true);
  });

  it('finds the separating axis of a rotated rectangle', () => {
    const square = rect(0, 0, 100, 100);
    // A diamond whose bounding box overlaps the square, but which is clear of its corner.
    expect(rectsOverlap(square, rect(160, 60, 100, 100, 45))).toBe(false);
    expect(rectsOverlap(rect(160, 60, 100, 100, 45), square)).toBe(false);
    expect(rectsOverlap(square, rect(120, 20, 100, 100, 45))).toBe(true);
  });
});

describe('distances', () => {
  it('measures from a point to a segment, its ends included', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(distancePointToSegment({ x: 50, y: 30 }, a, b)).toBe(30);
    expect(distancePointToSegment({ x: -30, y: 40 }, a, b)).toBe(50);
    expect(distancePointToSegment({ x: 130, y: 40 }, a, b)).toBe(50);
    expect(distancePointToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
  });

  it('measures from a point to a wall face', () => {
    const wall = { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };
    expect(distancePointToWall({ x: 25, y: 50 }, wall)).toBe(25);
    expect(distancePointToWall({ x: -25, y: 50 }, wall)).toBe(25);
  });

  it('measures between rectangles', () => {
    const square = rect(0, 0, 100, 100);
    expect(distanceRectToRect(square, rect(130, 0, 100, 100))).toBe(30);
    expect(distanceRectToRect(square, rect(130, 140, 100, 100))).toBe(50);
    expect(distanceRectToRect(square, rect(100, 0, 100, 100))).toBe(0);
    expect(distanceRectToRect(square, rect(50, 50, 100, 100))).toBe(0);
    // The corner of a diamond pointing at the middle of the square's right side.
    expect(distanceRectToRect(square, rect(120, 50, 100, 100, -45))).toBeCloseTo(20);
  });

  it('measures between a rectangle and a segment', () => {
    const square = rect(0, 0, 100, 100);
    expect(distanceRectToSegment(square, { x: 150, y: -50 }, { x: 150, y: 150 })).toBe(50);
    expect(distanceRectToSegment(square, { x: 130, y: 140 }, { x: 300, y: 140 })).toBe(50);
    expect(distanceRectToSegment(square, { x: -50, y: 50 }, { x: 150, y: 50 })).toBe(0);
    expect(distanceRectToSegment(square, { x: 100, y: -50 }, { x: 100, y: 150 })).toBe(0);
  });
});

describe('segmentCrossesRect', () => {
  const square = rect(0, 0, 100, 100);

  it('is true for a segment through the rectangle or ending inside it', () => {
    expect(segmentCrossesRect(square, { x: -50, y: 50 }, { x: 150, y: 50 })).toBe(true);
    expect(segmentCrossesRect(square, { x: 50, y: 150 }, { x: 50, y: 50 })).toBe(true);
    expect(segmentCrossesRect(square, { x: -10, y: -10 }, { x: 110, y: 110 })).toBe(true);
  });

  it('is false for a segment along an edge, outside, or stopping short', () => {
    expect(segmentCrossesRect(square, { x: 0, y: -50 }, { x: 0, y: 150 })).toBe(false);
    expect(segmentCrossesRect(square, { x: -50, y: 100 }, { x: 150, y: 100 })).toBe(false);
    expect(segmentCrossesRect(square, { x: 150, y: -50 }, { x: 150, y: 150 })).toBe(false);
    expect(segmentCrossesRect(square, { x: -80, y: 50 }, { x: -20, y: 50 })).toBe(false);
    expect(segmentCrossesRect(square, { x: -50, y: 20 }, { x: 20, y: -50 })).toBe(false);
  });

  it('works for a rotated rectangle', () => {
    const diamond = rect(100, 0, 100, 100, 45);
    expect(segmentCrossesRect(diamond, { x: 0, y: 70 }, { x: 200, y: 70 })).toBe(true);
    expect(segmentCrossesRect(diamond, { x: 0, y: 10 }, { x: 80, y: 10 })).toBe(false);
  });
});

describe('isClosedLoop', () => {
  const p = (x: number, y: number) => ({ x, y });
  const wall = (start: { x: number; y: number }, end: { x: number; y: number }) => ({ start, end });
  const triangle = [wall(p(0, 0), p(100, 0)), wall(p(100, 0), p(0, 100)), wall(p(0, 100), p(0, 0))];

  it('is true when each wall ends where the next starts and the last meets the first', () => {
    expect(isClosedLoop(triangle)).toBe(true);
  });

  it('is false for a gap, a last wall that stops short, or fewer than three walls', () => {
    expect(isClosedLoop([triangle[0]!, wall(p(100, 1), p(0, 100)), triangle[2]!])).toBe(false);
    expect(isClosedLoop([triangle[0]!, triangle[1]!, wall(p(0, 100), p(0, 1))])).toBe(false);
    expect(isClosedLoop([wall(p(0, 0), p(100, 0)), wall(p(100, 0), p(0, 0))])).toBe(false);
    expect(isClosedLoop([])).toBe(false);
  });
});

describe('pointInPolygon', () => {
  // An L-shaped room.
  const room = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];

  it('tells inside from outside, including the notch of a concave room', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, room)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, room)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 150 }, room)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 150 }, room)).toBe(false);
    expect(pointInPolygon({ x: -10, y: 50 }, room)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 250 }, room)).toBe(false);
  });
});

import { inches, STEP } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import {
  boundsOf,
  fitBounds,
  gridStep,
  viewportSettings,
  panBy,
  pixels,
  toDrawing,
  toScreen,
  type Viewport,
  visibleBounds,
  zoomAt,
} from './viewport';

const MIN_SCALE = viewportSettings.minScale;
const MAX_SCALE = viewportSettings.maxScale;
const ZOOMS = [MIN_SCALE, 1, 2.5, 4, 7.3, 16, MAX_SCALE];

describe('coordinate conversion', () => {
  it.each(ZOOMS)('round-trips screen to plan and back at %s px per inch', (scale) => {
    const viewport: Viewport = { scale, offsetX: 137.5, offsetY: -42.25 };
    for (const screen of [
      { x: 0, y: 0 },
      { x: 640, y: 360 },
      { x: -75.5, y: 1203.25 },
    ]) {
      const back = toScreen(viewport, toDrawing(viewport, screen));
      expect(back.x).toBeCloseTo(screen.x, 8);
      expect(back.y).toBeCloseTo(screen.y, 8);
    }
    for (const point of [
      { x: 0, y: 0 },
      { x: inches(34.5), y: inches(120) },
      { x: -inches(3), y: 1 },
    ]) {
      const back = toDrawing(viewport, toScreen(viewport, point));
      expect(back.x).toBeCloseTo(point.x, 8);
      expect(back.y).toBeCloseTo(point.y, 8);
    }
  });

  it('puts one inch `scale` pixels from the origin', () => {
    const viewport = { scale: 4, offsetX: 100, offsetY: 50 };
    expect(toScreen(viewport, { x: inches(30), y: inches(10) })).toEqual({ x: 220, y: 90 });
    expect(toDrawing(viewport, { x: 220, y: 90 })).toEqual({ x: inches(30), y: inches(10) });
    expect(pixels(viewport, 8)).toBe(inches(2));
  });
});

describe('pan and zoom', () => {
  it('pans by pixels', () => {
    expect(panBy({ scale: 4, offsetX: 10, offsetY: 20 }, 5, -7)).toEqual({
      scale: 4,
      offsetX: 15,
      offsetY: 13,
    });
  });

  it.each(ZOOMS)('zooms around the pointer at %s px per inch', (scale) => {
    const viewport = { scale, offsetX: 30, offsetY: 60 };
    const pointer = { x: 412, y: 268 };
    const under = toDrawing(viewport, pointer);
    for (const factor of [1.25, 0.8]) {
      const zoomed = zoomAt(viewport, pointer, factor);
      const still = toScreen(zoomed, under);
      expect(still.x).toBeCloseTo(pointer.x, 8);
      expect(still.y).toBeCloseTo(pointer.y, 8);
    }
  });

  it('keeps the scale within its limits', () => {
    const viewport = { scale: 4, offsetX: 0, offsetY: 0 };
    expect(zoomAt(viewport, { x: 0, y: 0 }, 1000).scale).toBe(MAX_SCALE);
    expect(zoomAt(viewport, { x: 0, y: 0 }, 0.0001).scale).toBe(MIN_SCALE);
  });
});

describe('fitBounds', () => {
  it('centres the bounds with a margin', () => {
    const bounds = { minX: 0, minY: 0, maxX: inches(120), maxY: inches(96) };
    const size = { width: 800, height: 600 };
    const viewport = fitBounds(bounds, size);
    const topLeft = toScreen(viewport, { x: 0, y: 0 });
    const bottomRight = toScreen(viewport, { x: inches(120), y: inches(96) });
    expect(topLeft.x).toBeGreaterThan(0);
    expect(topLeft.y).toBeGreaterThan(0);
    expect(bottomRight.x).toBeLessThan(size.width);
    expect(bottomRight.y).toBeLessThan(size.height);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(400, 8);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(300, 8);
  });

  it('does not zoom in past the limit it is given', () => {
    const tiny = { minX: 0, minY: 0, maxX: inches(3), maxY: inches(3) };
    expect(fitBounds(tiny, { width: 800, height: 600 }, 6).scale).toBe(6);
  });

  it('has bounds for a list of points and none for an empty list', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 4, y: -2 },
        { x: -1, y: 9 },
      ]),
    ).toEqual({ minX: -1, minY: -2, maxX: 4, maxY: 9 });
  });
});

describe('grid', () => {
  it('is every 3 in when zoomed in and every 12 in when zoomed out', () => {
    expect(gridStep({ scale: 8, offsetX: 0, offsetY: 0 })).toBe(STEP);
    expect(gridStep({ scale: 4, offsetX: 0, offsetY: 0 })).toBe(STEP);
    expect(gridStep({ scale: 2, offsetX: 0, offsetY: 0 })).toBe(inches(12));
  });

  it('knows which part of the drawing is on screen', () => {
    const viewport = { scale: 4, offsetX: 40, offsetY: 80 };
    expect(visibleBounds(viewport, { width: 400, height: 200 })).toEqual({
      minX: -inches(10),
      minY: -inches(20),
      maxX: inches(90),
      maxY: inches(30),
    });
  });
});

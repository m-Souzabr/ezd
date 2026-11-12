import { IN, type Len, type Pt, STEP } from '@ezd/core';

/**
 * How a drawing is placed on the screen. `scale` is pixels per inch; the offsets are the
 * screen position of the drawing's origin, in pixels.
 *
 * A drawing point is in sixteenths of an inch. In the plan it is a plan point. In an
 * elevation, x is the offset along the wall and y is the elevation negated, so up on the
 * wall is up on the screen.
 */
export type Viewport = { scale: number; offsetX: number; offsetY: number };
export type Size = { width: number; height: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 40;
/** At this scale or above the grid is drawn every 3 in; below it, every 12 in. */
export const FINE_GRID_MIN_SCALE = 4;
/** `fitBounds` never zooms in past this, so a single cabinet does not fill the screen. */
export const MAX_FIT_SCALE = 12;
const FIT_PADDING = 72;

export const DEFAULT_VIEWPORT: Viewport = { scale: 4, offsetX: 80, offsetY: 80 };

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const toScreen = (viewport: Viewport, point: Pt): Pt => ({
  x: (point.x / IN) * viewport.scale + viewport.offsetX,
  y: (point.y / IN) * viewport.scale + viewport.offsetY,
});

/** The drawing point under a screen point. Fractional: snapping makes it a `Len`. */
export const toDrawing = (viewport: Viewport, screen: Pt): Pt => ({
  x: ((screen.x - viewport.offsetX) / viewport.scale) * IN,
  y: ((screen.y - viewport.offsetY) / viewport.scale) * IN,
});

/** A length on screen, in pixels, as a drawing length. */
export const pixels = (viewport: Viewport, px: number): number => (px / viewport.scale) * IN;

export const panBy = (viewport: Viewport, dx: number, dy: number): Viewport => ({
  ...viewport,
  offsetX: viewport.offsetX + dx,
  offsetY: viewport.offsetY + dy,
});

/** Zooms by `factor`, keeping the drawing point under `screen` where it is. */
export function zoomAt(viewport: Viewport, screen: Pt, factor: number): Viewport {
  const scale = clampScale(viewport.scale * factor);
  const ratio = scale / viewport.scale;
  return {
    scale,
    offsetX: screen.x - (screen.x - viewport.offsetX) * ratio,
    offsetY: screen.y - (screen.y - viewport.offsetY) * ratio,
  };
}

/** The viewport that centres `bounds` in a canvas of `size`, with a margin around it. */
export function fitBounds(bounds: Bounds, size: Size, maxScale = MAX_FIT_SCALE): Viewport {
  const width = Math.max((bounds.maxX - bounds.minX) / IN, 1);
  const height = Math.max((bounds.maxY - bounds.minY) / IN, 1);
  const scale = clampScale(
    Math.min(
      maxScale,
      Math.max(size.width - 2 * FIT_PADDING, 1) / width,
      Math.max(size.height - 2 * FIT_PADDING, 1) / height,
    ),
  );
  const centreX = (bounds.minX + bounds.maxX) / 2 / IN;
  const centreY = (bounds.minY + bounds.maxY) / 2 / IN;
  return {
    scale,
    offsetX: size.width / 2 - centreX * scale,
    offsetY: size.height / 2 - centreY * scale,
  };
}

export const boundsOf = (points: readonly Pt[]): Bounds | null =>
  points.length === 0
    ? null
    : {
        minX: Math.min(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxX: Math.max(...points.map((p) => p.x)),
        maxY: Math.max(...points.map((p) => p.y)),
      };

/** The part of the drawing a canvas of `size` shows. */
export function visibleBounds(viewport: Viewport, size: Size): Bounds {
  const min = toDrawing(viewport, { x: 0, y: 0 });
  const max = toDrawing(viewport, { x: size.width, y: size.height });
  return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
}

/** Grid lines every 3 in when zoomed in, every 12 in when zoomed out. */
export const gridStep = (viewport: Viewport): Len =>
  viewport.scale >= FINE_GRID_MIN_SCALE ? STEP : 12 * IN;

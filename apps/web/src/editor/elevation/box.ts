import type { ElevationRect } from './model';

/** A rectangle given by its left and bottom, on a drawing whose y axis points down. */
export const box = (rect: ElevationRect) => ({
  x: rect.x,
  y: -(rect.y + rect.h),
  width: rect.w,
  height: rect.h,
});

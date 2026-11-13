import { inches, type Len, STEP } from '../units/index.js';

export type SnapOptions = {
  /** How near a wall's interior face the pointer must be for the wall to take the item. */
  wallCaptureDistance?: Len;
  /** How near a neighbour, wall end or opening edge an item must be to go flush against it. */
  edgeSnapDistance?: Len;
  grid?: Len;
  /** In degrees. */
  freeRotationStep?: number;
};

export const DEFAULT_SNAP_OPTIONS: Required<SnapOptions> = {
  wallCaptureDistance: inches(12),
  edgeSnapDistance: inches(1.5),
  grid: STEP,
  freeRotationStep: 90,
};

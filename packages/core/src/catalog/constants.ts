import { inches, type Len } from '../units/index.js';

// US industry-standard cabinet sizes and the fixed dimensions the generators share.

export const BASE_CABINET_HEIGHT: Len = inches(34.5);
export const BASE_CABINET_DEPTH: Len = inches(24);
export const WALL_CABINET_HEIGHTS: Len[] = [12, 15, 18, 24, 30, 36, 42].map(inches);
export const WALL_CABINET_DEPTH: Len = inches(12);
/** Bottom of a wall cabinet above the floor. */
export const WALL_CABINET_ELEVATION: Len = inches(54);
export const TALL_CABINET_HEIGHTS: Len[] = [84, 90, 96].map(inches);

export const COUNTERTOP_THICKNESS: Len = inches(1.5);
/** How far a countertop projects past the front of the cabinets under it. */
export const COUNTERTOP_OVERHANG: Len = inches(1.5);
/** Over a 24 in deep base cabinet. */
export const COUNTERTOP_DEPTH: Len = BASE_CABINET_DEPTH + COUNTERTOP_OVERHANG;
/** Finished counter height: a base cabinet plus its countertop. */
export const COUNTER_HEIGHT: Len = BASE_CABINET_HEIGHT + COUNTERTOP_THICKNESS;

export const TOE_KICK_HEIGHT: Len = inches(4.5);
/** How far the toe kick sits behind the cabinet front. */
export const TOE_KICK_DEPTH: Len = inches(3);

/** Carcass panels, doors, drawer fronts, fillers and end panels. */
export const PANEL_THICKNESS: Len = inches(0.75);
/** Between the counter and the wall cabinets. */
export const BACKSPLASH_HEIGHT: Len = inches(18);

export const FILLER_MIN_WIDTH: Len = inches(0.5);
export const FILLER_MAX_WIDTH: Len = inches(6);

/** The gap between neighbouring doors and drawer fronts. */
export const FRONT_REVEAL: Len = inches(0.125);
/** Shelves are never farther apart than this. */
export const MAX_SHELF_SPACING: Len = inches(15);
/** The drawer front above the doors of a base cabinet. */
export const TOP_DRAWER_FRONT_HEIGHT: Len = inches(6);
/** The opening a tall cabinet leaves for one built-in oven. */
export const OVEN_OPENING_HEIGHT: Len = inches(27);

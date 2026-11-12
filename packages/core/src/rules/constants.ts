import { inches, type Len } from '../units/index.js';

// Every threshold the rules use. These are design-quality guidelines, not building code.

/** The narrowest cabinet. A gap smaller than this cannot take one, so it needs a filler. */
export const MIN_CABINET_GAP: Len = inches(9);
/** The widest gap a single filler closes. */
export const MAX_FILLER_GAP: Len = inches(6);

/** The least room to walk between facing runs or around an island. */
export const MIN_AISLE: Len = inches(36);
export const RECOMMENDED_AISLE: Len = inches(42);

/** Clear height above a range under anything but a hood. */
export const RANGE_OVERHEAD_CLEARANCE: Len = inches(30);
/** A dishwasher loads from the sink, so it sits within this distance of one. */
export const DISHWASHER_SINK_DISTANCE: Len = inches(36);
/** What a refrigerator door needs beside a side wall to open past 90 degrees. */
export const FRIDGE_HINGE_CLEARANCE: Len = inches(3);

/** The sum of the three legs between sink, range and refrigerator. */
export const WORK_TRIANGLE_MIN: Len = inches(156);
export const WORK_TRIANGLE_MAX: Len = inches(312);

// The catalog entries the appliance and layout rules look for.
export const RANGE_ID = 'appliance.range';
export const HOOD_ID = 'appliance.hood';
export const FRIDGE_ID = 'appliance.fridge';
export const DISHWASHER_ID = 'appliance.dishwasher';
export const SINK_ID = 'base.sink';

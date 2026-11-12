import type { Rule } from '../types.js';
import { applianceDishwasherSink } from './appliance-dishwasher-sink.js';
import { applianceFridgeDoor } from './appliance-fridge-door.js';
import { applianceRangeOverhead } from './appliance-range-overhead.js';
import { clearanceAisle } from './clearance-aisle.js';
import { clearanceDoorSwing } from './clearance-door-swing.js';
import { cornerConflict } from './corner-conflict.js';
import { countertopCoverage } from './countertop-coverage.js';
import { gapNeedsFiller } from './gap-needs-filler.js';
import { itemBlocksDoor } from './item-blocks-door.js';
import { itemBlocksWindow } from './item-blocks-window.js';
import { itemCatalog } from './item-catalog.js';
import { itemExceedsCeiling } from './item-exceeds-ceiling.js';
import { itemOutsideRoom } from './item-outside-room.js';
import { itemOutsideWall } from './item-outside-wall.js';
import { itemOverlap } from './item-overlap.js';
import { layoutWorkTriangle } from './layout-work-triangle.js';
import { openingInvalid } from './opening-invalid.js';
import { roomOpen } from './room-open.js';
import { sizeStandard } from './size-standard.js';
import { sizeWidthStep } from './size-width-step.js';
import { wallAlignment } from './wall-alignment.js';

/** Every rule `validate` runs. */
export const RULES: readonly Rule[] = [
  sizeWidthStep,
  sizeStandard,
  itemCatalog,
  itemOverlap,
  itemOutsideWall,
  itemOutsideRoom,
  itemExceedsCeiling,
  itemBlocksDoor,
  itemBlocksWindow,
  openingInvalid,
  cornerConflict,
  gapNeedsFiller,
  clearanceDoorSwing,
  clearanceAisle,
  applianceRangeOverhead,
  applianceDishwasherSink,
  applianceFridgeDoor,
  wallAlignment,
  countertopCoverage,
  roomOpen,
  layoutWorkTriangle,
];

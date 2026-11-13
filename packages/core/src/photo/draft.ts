import { type Catalog, getEntry, nearestAllowedWidth } from '../catalog/index.js';
import { applyCommand, type Command, type CommandOf } from '../commands/index.js';
import {
  createEmptyDocument,
  DEFAULT_CEILING_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  type DesignDocument,
  type Id,
  type OpeningKind,
  type Point,
} from '../document/index.js';
import { rangesOverlap } from '../geometry/index.js';
import { err, ok, type Result } from '../result.js';
import { formatLength, IN, inches, type Len } from '../units/index.js';
import type {
  DraftCategory,
  DraftItem,
  DraftLen,
  DraftOpening,
  DraftRoom,
  DraftShape,
  DraftWall,
  RoomDraft,
} from './schema.js';

/** How many walls each shape has. An unknown shape has to be picked before confirming. */
export const SHAPE_WALL_COUNT: Record<DraftShape, number | null> = {
  'single-wall': 1,
  galley: 2,
  'l-shape': 2,
  'u-shape': 3,
  rectangle: 4,
  unknown: null,
};

export const DRAFT_SHAPES: { shape: Exclude<DraftShape, 'unknown'>; name: string }[] = [
  { shape: 'single-wall', name: 'One wall' },
  { shape: 'galley', name: 'Galley (two facing walls)' },
  { shape: 'l-shape', name: 'L shape (two walls at a corner)' },
  { shape: 'u-shape', name: 'U shape (three walls)' },
  { shape: 'rectangle', name: 'Closed room (four walls)' },
];

/** The catalog entry each detected category becomes. */
export const CATEGORY_CATALOG_IDS: Record<DraftCategory, string> = {
  base: 'base.standard',
  wall: 'wall.standard',
  tall: 'tall.pantry',
  range: 'appliance.range',
  fridge: 'appliance.fridge',
  dishwasher: 'appliance.dishwasher',
  sink: 'base.sink',
  hood: 'appliance.hood',
  microwave: 'appliance.microwave',
};

export const CATEGORY_NAMES: Record<DraftCategory, string> = {
  base: 'Base cabinet',
  wall: 'Wall cabinet',
  tall: 'Tall cabinet',
  range: 'Range',
  fridge: 'Refrigerator',
  dishwasher: 'Dishwasher',
  sink: 'Sink base',
  hood: 'Range hood',
  microwave: 'Microwave',
};

/** Sizes an opening gets when the photo does not show them. */
export const DEFAULT_OPENING_SIZE: Record<OpeningKind, { height: Len; sillHeight: Len }> = {
  door: { height: inches(80), sillHeight: 0 },
  window: { height: inches(36), sillHeight: inches(42) },
  passage: { height: inches(80), sillHeight: 0 },
};

/** Larger than any kitchen wall: a model value past it is treated as unknown. */
export const MAX_DRAFT_LENGTH: Len = inches(1200);
/** What the preview draws for a wall or galley width that has no length yet. */
export const PREVIEW_LENGTH: Len = inches(120);

export const DRAFT_LABEL = 'Room from photo';

const UNKNOWN: DraftLen = { value: null, estimated: false };

/** The wall label at an index: A, B, C. */
export const draftWallLabel = (index: number): string => String.fromCharCode(65 + index);

/** A model value in inches as a `Len` rounded to 1/16 in, marked as an estimate. */
function fromModel(value: number | null, { allowZero = false } = {}): DraftLen {
  if (value === null || !Number.isFinite(value)) return UNKNOWN;
  const len = Math.round(value * IN);
  if (len < 0 || (len === 0 && !allowZero) || len > MAX_DRAFT_LENGTH) return UNKNOWN;
  return { value: len, estimated: true };
}

const estimate = (value: Len): DraftLen => ({ value, estimated: true });

/** Moves `offset` back so `width` fits on a wall of `length`, when both are known. */
function clampOffset(offset: DraftLen, width: Len | null, length: Len | null): DraftLen {
  if (offset.value === null || length === null) return offset;
  const max = Math.max(0, length - (width ?? 0));
  return offset.value > max ? { ...offset, value: max } : offset;
}

/**
 * The model's answer as a draft the user can correct: lengths in `Len`, walls relabelled
 * A, B, C, cabinets mapped to catalog entries at their nearest allowed width and standard
 * height and depth, offsets moved into their walls, and every length marked as an estimate.
 * Openings and items on a wall the model did not list are dropped, as are categories the
 * catalog does not have.
 */
export function normalizeDraft(raw: DraftRoom, catalog: Catalog): RoomDraft {
  const labels = new Map<string, string>();
  const walls: DraftWall[] = raw.walls.map((wall, index) => {
    const label = draftWallLabel(index);
    if (!labels.has(wall.label)) labels.set(wall.label, label);
    return {
      label,
      length: fromModel(wall.lengthIn),
      visible: wall.visible,
      confidence: wall.confidence,
    };
  });
  const lengthOf = (label: string): Len | null =>
    walls.find((wall) => wall.label === label)?.length.value ?? null;

  const openings: DraftOpening[] = [];
  for (const opening of raw.openings) {
    const wall = labels.get(opening.wall);
    if (wall === undefined) continue;
    const defaults = DEFAULT_OPENING_SIZE[opening.kind];
    const width = fromModel(opening.widthIn);
    const height = fromModel(opening.heightIn);
    const sill = opening.kind === 'window' ? fromModel(opening.sillIn) : UNKNOWN;
    openings.push({
      wall,
      kind: opening.kind,
      offset: clampOffset(
        fromModel(opening.offsetIn, { allowZero: true }),
        width.value,
        lengthOf(wall),
      ),
      width,
      height: height.value === null ? estimate(defaults.height) : height,
      sillHeight:
        opening.kind !== 'window'
          ? { value: 0, estimated: false }
          : sill.value === null
            ? estimate(defaults.sillHeight)
            : sill,
      confidence: opening.confidence,
    });
  }

  const items: DraftItem[] = [];
  for (const item of raw.items) {
    const wall = labels.get(item.wall);
    const entry = getEntry(catalog, CATEGORY_CATALOG_IDS[item.category]);
    if (wall === undefined || !entry) continue;
    const detected = fromModel(item.widthIn);
    const width = nearestAllowedWidth(entry, detected.value ?? entry.defaultSize.width);
    items.push({
      wall,
      category: item.category,
      catalogId: entry.id,
      kind: entry.kind,
      offset: clampOffset(fromModel(item.offsetIn, { allowZero: true }), width, lengthOf(wall)),
      width: estimate(width),
      height: entry.defaultSize.height,
      depth: entry.defaultSize.depth,
      elevation: entry.defaultElevation,
      confidence: item.confidence,
    });
  }

  const ceiling = fromModel(raw.ceilingHeightIn);
  return {
    shape: raw.shape,
    ceilingHeight: ceiling.value === null ? estimate(DEFAULT_CEILING_HEIGHT) : ceiling,
    walls,
    galleyWidth: UNKNOWN,
    openings,
    items,
    notes: raw.notes,
  };
}

/**
 * The draft with another shape: walls are added (with no length) or removed at the end so
 * there are as many as the shape has. Openings and items on a removed wall stay, and
 * `draftProblems` asks the user to move or delete them.
 */
export function setDraftShape(draft: RoomDraft, shape: DraftShape): RoomDraft {
  const count = SHAPE_WALL_COUNT[shape];
  if (count === null) return { ...draft, shape };
  const walls = draft.walls.slice(0, count);
  for (let index = walls.length; index < count; index += 1) {
    walls.push({
      label: draftWallLabel(index),
      length: UNKNOWN,
      visible: false,
      confidence: 'high',
    });
  }
  return { ...draft, shape, walls };
}

const kindName = (kind: OpeningKind): string => kind.charAt(0).toUpperCase() + kind.slice(1);

/** `Door 2 on wall A`: numbered among the openings of its kind. */
export function draftOpeningName(draft: RoomDraft, index: number): string {
  const opening = draft.openings[index]!;
  const number = draft.openings.slice(0, index + 1).filter((o) => o.kind === opening.kind).length;
  return `${kindName(opening.kind)} ${number} on wall ${opening.wall}`;
}

/** `Base cabinet 30" at 12" on wall A`, as the rules name items. */
export function draftItemName(item: DraftItem): string {
  const width = item.width.value === null ? '' : ` ${formatLength(item.width.value)}`;
  const at = item.offset.value === null ? '' : ` at ${formatLength(item.offset.value)}`;
  return `${CATEGORY_NAMES[item.category]}${width}${at} on wall ${item.wall}`;
}

const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * What still stops the draft from becoming a design, as sentences for the user. Empty when
 * it can be confirmed. Every wall length must have been typed or confirmed by the user.
 */
export function draftProblems(draft: RoomDraft): string[] {
  const problems: string[] = [];
  const count = SHAPE_WALL_COUNT[draft.shape];
  if (count === null) problems.push('Pick the shape of the room.');
  else if (draft.walls.length !== count) {
    problems.push(`This shape has ${count} walls, but the draft has ${draft.walls.length}.`);
  }

  const lengths = new Map<string, Len | null>();
  for (const wall of draft.walls) {
    lengths.set(wall.label, wall.length.value);
    if (wall.length.value === null || wall.length.value === 0) {
      problems.push(`Type the length of wall ${wall.label}.`);
    } else if (wall.length.estimated) {
      problems.push(`Confirm the length of wall ${wall.label}, or type it.`);
    }
  }
  if (draft.shape === 'galley') {
    if (draft.galleyWidth.value === null || draft.galleyWidth.value === 0) {
      problems.push('Type the distance between walls A and B.');
    } else if (draft.galleyWidth.estimated) {
      problems.push('Confirm the distance between walls A and B, or type it.');
    }
  }
  if (draft.shape === 'rectangle' && draft.walls.length === 4) {
    for (const [a, b] of [
      ['A', 'C'],
      ['B', 'D'],
    ] as const) {
      const la = lengths.get(a);
      const lb = lengths.get(b);
      if (la && lb && la !== lb) {
        problems.push(`Walls ${a} and ${b} face each other, so they must be the same length.`);
      }
    }
  }

  /** Checks an entity's place on its wall; returns its span when it is known. */
  const placeOn = (
    name: string,
    wall: string,
    fields: [string, DraftLen][],
    offset: DraftLen,
    width: DraftLen,
  ): [Len, Len] | null => {
    if (!lengths.has(wall)) {
      problems.push(`${name} is on wall ${wall}, which the room does not have.`);
      return null;
    }
    const missing = fields.filter(([, value]) => value.value === null).map(([field]) => field);
    if (missing.length > 0) {
      problems.push(`Give the ${missing.join(' and ')} of ${lower(name)}.`);
      return null;
    }
    const span: [Len, Len] = [offset.value!, offset.value! + width.value!];
    const length = lengths.get(wall);
    if (length && span[1] > length) problems.push(`${name} runs past the end of wall ${wall}.`);
    return span;
  };

  draft.openings.forEach((opening, index) => {
    const fields: [string, DraftLen][] = [
      ['offset', opening.offset],
      ['width', opening.width],
      ['height', opening.height],
    ];
    if (opening.kind === 'window') fields.push(['sill height', opening.sillHeight]);
    if (opening.width.value === 0 || opening.height.value === 0) {
      problems.push(`${draftOpeningName(draft, index)} needs a width and a height.`);
      return;
    }
    placeOn(draftOpeningName(draft, index), opening.wall, fields, opening.offset, opening.width);
  });

  const placed: { item: DraftItem; span: [Len, Len] }[] = [];
  for (const item of draft.items) {
    const fields: [string, DraftLen][] = [
      ['offset', item.offset],
      ['width', item.width],
    ];
    const span = placeOn(draftItemName(item), item.wall, fields, item.offset, item.width);
    if (!span) continue;
    const vertical: [Len, Len] = [item.elevation, item.elevation + item.height];
    for (const other of placed) {
      if (other.item.wall !== item.wall) continue;
      const otherVertical: [Len, Len] = [
        other.item.elevation,
        other.item.elevation + other.item.height,
      ];
      if (rangesOverlap(span, other.span) && rangesOverlap(vertical, otherVertical)) {
        problems.push(`${draftItemName(item)} overlaps ${lower(draftItemName(other.item))}.`);
      }
    }
    placed.push({ item, span });
  }
  return problems;
}

/** Start and end of each wall, clockwise as the document expects, from the shape and lengths. */
function wallPoints(shape: DraftShape, lengths: Len[], galleyWidth: Len): [Point, Point][] {
  const [a = 0, b = 0, c = 0] = lengths;
  switch (shape) {
    case 'single-wall':
      return [
        [
          { x: 0, y: 0 },
          { x: a, y: 0 },
        ],
      ];
    case 'galley':
      // Facing each other across the room: A runs left to right, B right to left.
      return [
        [
          { x: 0, y: 0 },
          { x: a, y: 0 },
        ],
        [
          { x: b, y: galleyWidth },
          { x: 0, y: galleyWidth },
        ],
      ];
    case 'l-shape':
      return [
        [
          { x: 0, y: 0 },
          { x: a, y: 0 },
        ],
        [
          { x: a, y: 0 },
          { x: a, y: b },
        ],
      ];
    case 'u-shape':
      return [
        [
          { x: 0, y: a },
          { x: 0, y: 0 },
        ],
        [
          { x: 0, y: 0 },
          { x: b, y: 0 },
        ],
        [
          { x: b, y: 0 },
          { x: b, y: c },
        ],
      ];
    case 'rectangle':
      // C and D follow from A and B, which `draftProblems` checks they match.
      return [
        [
          { x: 0, y: 0 },
          { x: a, y: 0 },
        ],
        [
          { x: a, y: 0 },
          { x: a, y: b },
        ],
        [
          { x: a, y: b },
          { x: 0, y: b },
        ],
        [
          { x: 0, y: b },
          { x: 0, y: 0 },
        ],
      ];
    case 'unknown':
      return [];
  }
}

export type DraftNewId = (prefix: 'wall' | 'opening' | 'item') => Id;

type Built = { commands: Command[]; skipped: number };

/**
 * The commands for a draft. Strict, every value is used as it is; lenient (the preview)
 * draws a wall with no length at `PREVIEW_LENGTH` and leaves out what cannot be placed.
 */
function build(draft: RoomDraft, newId: DraftNewId, lenient: boolean): Built {
  let shape = draft.shape;
  if (shape === 'unknown') {
    shape =
      (['single-wall', 'l-shape', 'u-shape', 'rectangle'] as const)[draft.walls.length - 1] ??
      'unknown';
  }
  const lengths = draft.walls.map((wall) => wall.length.value || PREVIEW_LENGTH);
  const points = wallPoints(shape, lengths, draft.galleyWidth.value || PREVIEW_LENGTH);
  const wallIds = new Map<string, Id>();
  const commands: Command[] = [
    { type: 'room.setCeilingHeight', height: draft.ceilingHeight.value || DEFAULT_CEILING_HEIGHT },
  ];
  points.forEach(([start, end], index) => {
    const id = newId('wall');
    wallIds.set(draftWallLabel(index), id);
    commands.push({
      type: 'wall.add',
      wall: { id, start, end, thickness: DEFAULT_WALL_THICKNESS },
    });
  });

  let skipped = 0;
  const lengthOf = (label: string): Len => {
    const index = label.charCodeAt(0) - 65;
    return lengths[index] ?? 0;
  };
  const fits = (wall: string, offset: Len | null, width: Len | null): boolean =>
    !lenient ||
    (wallIds.has(wall) && offset !== null && !!width && offset + width <= lengthOf(wall));

  for (const opening of draft.openings) {
    const { offset, width, height, sillHeight } = opening;
    if (!fits(opening.wall, offset.value, width.value) || !height.value) {
      skipped += 1;
      continue;
    }
    commands.push({
      type: 'opening.add',
      opening: {
        id: newId('opening'),
        wallId: wallIds.get(opening.wall)!,
        kind: opening.kind,
        offset: offset.value!,
        width: width.value!,
        height: height.value,
        sillHeight: opening.kind === 'window' ? (sillHeight.value ?? 0) : 0,
      },
    });
  }
  for (const item of draft.items) {
    if (!fits(item.wall, item.offset.value, item.width.value)) {
      skipped += 1;
      continue;
    }
    commands.push({
      type: 'item.add',
      item: {
        id: newId('item'),
        catalogId: item.catalogId,
        kind: item.kind,
        width: item.width.value!,
        height: item.height,
        depth: item.depth,
        elevation: item.elevation,
        placement: { type: 'wall', wallId: wallIds.get(item.wall)!, offset: item.offset.value! },
        options: {},
      },
    });
  }
  return { commands, skipped };
}

/**
 * The confirmed draft as one `batch`: the ceiling height, the walls from the shape and
 * lengths (clockwise), then the openings, then the items. Refused with `draftProblems`
 * while the draft has any. Rule violations are allowed; the editor shows them.
 */
export function draftToCommands(
  draft: RoomDraft,
  newId: DraftNewId,
): Result<CommandOf<'batch'>, string[]> {
  const problems = draftProblems(draft);
  if (problems.length > 0) return err(problems);
  return ok({ type: 'batch', label: DRAFT_LABEL, commands: build(draft, newId, false).commands });
}

/** Ids for a preview, which is never stored. */
function previewIds(): DraftNewId {
  const serials = new Map<string, number>();
  return (prefix) => {
    const serial = (serials.get(prefix) ?? 0) + 1;
    serials.set(prefix, serial);
    return `draft-${prefix}-${String(serial).padStart(2, '0')}`;
  };
}

/**
 * What the draft looks like so far, for the live plan preview: walls with no length are
 * drawn at `PREVIEW_LENGTH`, and what cannot be placed yet is left out and counted.
 */
export function draftPreview(draft: RoomDraft): { doc: DesignDocument; skipped: number } {
  const { commands, skipped } = build(draft, previewIds(), true);
  let doc = createEmptyDocument({ id: 'draft-preview', name: 'Draft' });
  let failed = 0;
  for (const command of commands) {
    const applied = applyCommand(doc, command);
    if (applied.ok) doc = applied.value.doc;
    else failed += 1;
  }
  return { doc, skipped: skipped + failed };
}

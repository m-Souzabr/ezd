import {
  applyCommand,
  type Command,
  createEmptyDocument,
  type DesignDocument,
  defaultItemFor,
  getEntry,
  inches,
  type Placement,
  SEED_CATALOG,
} from '@ezd/core';

// A small kitchen with a few flaws, for the Rules page to count violations on before a
// change is published. It is built with core's own commands, so it is always a valid document.

const wall = (id: string, from: [number, number], to: [number, number]): Command => ({
  type: 'wall.add',
  wall: {
    id,
    start: { x: inches(from[0]), y: inches(from[1]) },
    end: { x: inches(to[0]), y: inches(to[1]) },
    thickness: inches(4.5),
  },
});

const onWall = (wallId: string, offset: number): Placement => ({
  type: 'wall',
  wallId,
  offset: inches(offset),
});

export function sampleDesign(): DesignDocument {
  const items: [string, Placement, Partial<{ elevation: number; width: number }>?][] = [
    ['base.standard', onWall('wall-north', 0)],
    ['base.standard', onWall('wall-north', 32)],
    ['base.standard', onWall('wall-north', 66)],
    ['base.standard', { type: 'free', x: inches(40), y: inches(54), rotation: 0 }],
    ['appliance.range', onWall('wall-east', 30)],
    ['wall.standard', onWall('wall-east', 30)],
    ['appliance.dishwasher', onWall('wall-south', 0)],
    ['base.sink', onWall('wall-south', 72)],
    ['appliance.fridge', onWall('wall-west', 0)],
    ['wall.standard', onWall('wall-north', 100), { elevation: inches(60) }],
    ['wall.standard', onWall('wall-north', 130), { elevation: inches(54) }],
  ];
  const commands: Command[] = [
    wall('wall-north', [0, 0], [144, 0]),
    wall('wall-east', [144, 0], [144, 120]),
    wall('wall-south', [144, 120], [0, 120]),
    wall('wall-west', [0, 120], [0, 0]),
    ...items.map(([catalogId, placement, overrides], index): Command => ({
      type: 'item.add',
      item: {
        ...defaultItemFor(
          getEntry(SEED_CATALOG, catalogId)!,
          `sample-${String(index).padStart(4, '0')}`,
          placement,
        ),
        ...overrides,
      },
    })),
  ];
  const applied = applyCommand(
    createEmptyDocument({ id: 'sample-kitchen', name: 'Sample kitchen' }),
    { type: 'batch', commands },
    { catalog: SEED_CATALOG },
  );
  if (!applied.ok) throw new Error(applied.error.message);
  return applied.value.doc;
}

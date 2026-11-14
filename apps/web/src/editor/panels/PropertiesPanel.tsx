import {
  allowedOptionValues,
  allowedWidths,
  type Command,
  type Countertop,
  formatLength,
  getEntry,
  type Item,
  type Len,
  type Opening,
  type OptionDef,
  type OptionValue,
  type Swing,
  type Wall,
  wallLabel,
  wallLength,
} from '@ezd/core';
import { useState } from 'react';

import { FieldError } from '@/components/ui/field';
import { useDesign, useDesignStore } from '../../store/context';
import { selectedId } from '../../store/selectors';
import { resizeCommand } from '../edits';
import { itemCode } from '../labels';
import { findTarget } from '../tools/select';
import { CheckboxField, LengthField, PanelSection, SelectField } from './fields';

/** Runs one command and returns core's message if it was refused. */
function useRun(): (command: Command | null) => string | null {
  const store = useDesignStore();
  return (command) => {
    if (!command) return null;
    const executed = store.getState().execute(command);
    return executed.ok ? null : executed.error.message;
  };
}

const NONE = '';
/** Offered as dropdown choices only when the list is short; a filler has one per 1/16 in. */
const MAX_WIDTH_CHOICES = 40;

const lengthOptions = (lengths: readonly Len[], current: Len) =>
  [...new Set([...lengths, current])]
    .sort((a, b) => a - b)
    .map((length) => ({ value: String(length), label: formatLength(length) }));

const title = (key: string): string =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (first) => first.toUpperCase());

function OptionField({
  def,
  value,
  onChange,
}: {
  def: OptionDef;
  value: OptionValue;
  onChange(value: OptionValue): void;
}) {
  if (def.type === 'bool') {
    return <CheckboxField label={title(def.key)} checked={value === true} onChange={onChange} />;
  }
  const values = allowedOptionValues(def);
  return (
    <SelectField
      label={title(def.key)}
      value={String(value)}
      options={values.map((choice) => ({ value: String(choice), label: String(choice) }))}
      onChange={(text) => {
        const chosen = values.find((choice) => String(choice) === text);
        if (chosen !== undefined) onChange(chosen);
      }}
    />
  );
}

function ItemProperties({ item }: { item: Item }) {
  const catalog = useDesign((state) => state.catalog);
  const doc = useDesign((state) => state.doc);
  const run = useRun();
  // What core said about the last dropdown or checkbox edit it refused.
  const [refused, setRefused] = useState<string | null>(null);
  const change = (command: Command) => setRefused(run(command));

  const entry = getEntry(catalog, item.catalogId);
  const widths = entry ? allowedWidths(entry) : [];
  const square = entry?.corner === 'l' || entry?.corner === 'diagonal';
  const { placement } = item;
  // A retired finish is not offered, but one the item already has stays in the list.
  const finishes = catalog.finishes.filter(
    (finish) => finish.target === 'cabinet' && (!finish.retired || finish.id === item.finishId),
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <p className="text-sm font-semibold">
          {entry ? entry.name.replace(/\s*\(.*\)$/, '') : item.catalogId}
        </p>
        <p className="font-mono text-xs text-muted-foreground">{itemCode(item)}</p>
      </div>

      <LengthField
        label="Width"
        value={item.width}
        {...(widths.length <= MAX_WIDTH_CHOICES && { choices: widths })}
        onCommit={(width) => run(resizeCommand(catalog, item, width))}
      />
      <SelectField
        label="Height"
        value={String(item.height)}
        options={lengthOptions(entry?.heights ?? [], item.height)}
        onChange={(height) => change({ type: 'item.resize', id: item.id, height: Number(height) })}
      />
      <SelectField
        label="Depth"
        value={String(item.depth)}
        options={lengthOptions(entry?.depths ?? [], item.depth)}
        disabled={square}
        onChange={(depth) => change({ type: 'item.resize', id: item.id, depth: Number(depth) })}
      />

      {placement.type === 'wall' ? (
        <LengthField
          label={`Offset along wall ${wallLabel(doc, placement.wallId)}`}
          value={placement.offset}
          onCommit={(offset) =>
            run({ type: 'item.move', id: item.id, placement: { ...placement, offset } })
          }
        />
      ) : (
        <SelectField
          label="Rotation"
          value={String(placement.rotation)}
          options={[...new Set([0, 90, 180, 270, placement.rotation])]
            .sort((a, b) => a - b)
            .map((angle) => ({ value: String(angle), label: `${angle}°` }))}
          onChange={(rotation) =>
            change({
              type: 'item.move',
              id: item.id,
              placement: { ...placement, rotation: Number(rotation) },
            })
          }
        />
      )}
      <LengthField
        label="Elevation above floor"
        value={item.elevation}
        onCommit={(elevation) => run({ type: 'item.move', id: item.id, placement, elevation })}
      />

      {entry?.options.map((def) => (
        <OptionField
          key={def.key}
          def={def}
          value={item.options[def.key] ?? def.default}
          onChange={(value) =>
            change({ type: 'item.setOptions', id: item.id, options: { [def.key]: value } })
          }
        />
      ))}

      <SelectField
        label="Finish"
        value={item.finishId ?? NONE}
        options={[
          { value: NONE, label: 'Design default' },
          ...finishes.map((finish) => ({ value: finish.id, label: finish.name })),
        ]}
        onChange={(finishId) =>
          change({
            type: 'item.setOptions',
            id: item.id,
            options: {},
            finishId: finishId === NONE ? null : finishId,
          })
        }
      />

      {refused && <FieldError className="text-xs">{refused}</FieldError>}
    </div>
  );
}

const SWINGS: { value: Swing; label: string }[] = [
  { value: 'in-left', label: 'Into the room, hinged left' },
  { value: 'in-right', label: 'Into the room, hinged right' },
  { value: 'out-left', label: 'Out of the room, hinged left' },
  { value: 'out-right', label: 'Out of the room, hinged right' },
];

function OpeningProperties({ opening }: { opening: Opening }) {
  const doc = useDesign((state) => state.doc);
  const run = useRun();
  const update = (patch: Extract<Command, { type: 'opening.update' }>['patch']) =>
    run({ type: 'opening.update', id: opening.id, patch });
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm font-semibold capitalize">
        {opening.kind} on wall {wallLabel(doc, opening.wallId)}
      </p>
      <LengthField
        label="Offset along the wall"
        value={opening.offset}
        onCommit={(offset) => update({ offset })}
      />
      <LengthField label="Width" value={opening.width} onCommit={(width) => update({ width })} />
      <LengthField
        label="Height"
        value={opening.height}
        onCommit={(height) => update({ height })}
      />
      {opening.kind === 'window' && (
        <LengthField
          label="Sill height"
          value={opening.sillHeight}
          onCommit={(sillHeight) => update({ sillHeight })}
        />
      )}
      {opening.kind === 'door' && (
        <SelectField
          label="Swing"
          value={opening.swing ?? NONE}
          options={[{ value: NONE, label: 'No door leaf' }, ...SWINGS]}
          onChange={(swing) => {
            update({ swing: SWINGS.find((choice) => choice.value === swing)?.value ?? null });
          }}
        />
      )}
    </div>
  );
}

function WallProperties({ wall }: { wall: Wall }) {
  const doc = useDesign((state) => state.doc);
  const run = useRun();
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm font-semibold">Wall {wallLabel(doc, wall.id)}</p>
      <p className="text-sm text-muted-foreground">Length {formatLength(wallLength(wall))}</p>
      <LengthField
        label="Thickness"
        value={wall.thickness}
        onCommit={(thickness) => run({ type: 'wall.update', id: wall.id, patch: { thickness } })}
      />
    </div>
  );
}

function CountertopProperties({ countertop }: { countertop: Countertop }) {
  const doc = useDesign((state) => state.doc);
  const catalog = useDesign((state) => state.catalog);
  const run = useRun();
  const finishes = catalog.finishes.filter(
    (finish) =>
      finish.target === 'countertop' && (!finish.retired || finish.id === countertop.finishId),
  );
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm font-semibold">
        Countertop on wall {wallLabel(doc, countertop.wallId)}
      </p>
      <p className="text-sm text-muted-foreground">
        {formatLength(countertop.endOffset - countertop.startOffset)} long,{' '}
        {formatLength(countertop.depth)} deep, from {formatLength(countertop.startOffset)}
      </p>
      <SelectField
        label="Finish"
        value={countertop.finishId ?? NONE}
        options={[
          { value: NONE, label: 'Design default' },
          ...finishes.map((finish) => ({ value: finish.id, label: finish.name })),
        ]}
        onChange={(finishId) => {
          run({
            type: 'countertop.update',
            id: countertop.id,
            patch: { finishId: finishId === NONE ? null : finishId },
          });
        }}
      />
    </div>
  );
}

function RoomProperties() {
  const ceilingHeight = useDesign((state) => state.doc.room.ceilingHeight);
  const run = useRun();
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm text-muted-foreground">Select an item, opening or wall to edit it.</p>
      <LengthField
        label="Ceiling height"
        value={ceilingHeight}
        onCommit={(height) =>
          height === 0
            ? 'The ceiling height must be more than 0".'
            : run({ type: 'room.setCeilingHeight', height })
        }
      />
    </div>
  );
}

/** Edits whatever is selected. Every edit executes one command. */
export function PropertiesPanel() {
  const doc = useDesign((state) => state.doc);
  const id = useDesign(selectedId);
  const count = useDesign((state) => state.selection.length);
  const target = id ? findTarget(doc, id) : null;

  let body;
  if (count > 1) {
    body = <p className="p-3 text-sm text-muted-foreground">{count} things selected.</p>;
  } else if (!target) {
    body = <RoomProperties />;
  } else if (target.kind === 'item') {
    // Keyed by id, so a field being typed in does not carry over to another item.
    body = <ItemProperties key={target.id} item={target.item} />;
  } else if (target.kind === 'opening') {
    body = <OpeningProperties key={target.id} opening={target.opening} />;
  } else if (target.kind === 'wall') {
    body = <WallProperties key={target.id} wall={target.wall} />;
  } else {
    body = <CountertopProperties key={target.id} countertop={target.countertop} />;
  }
  return (
    <PanelSection title="Properties">
      <div className="overflow-y-auto">{body}</div>
    </PanelSection>
  );
}

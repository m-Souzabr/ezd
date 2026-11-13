import {
  allowedOptionValues,
  type CatalogEntry,
  type CatalogProblem,
  type Len,
  type OptionDef,
  type WidthRule,
} from '@ezd/core';

import { CheckboxField, LengthField, SelectField } from '../../editor/panels/fields';
import { CommitField, LengthListField, MoneyField } from './fields';
import { withRetired } from './helpers';

type Props = {
  entry: CatalogEntry;
  problems: readonly CatalogProblem[];
  onChange(entry: CatalogEntry): void;
};

type WidthKind = 'range' | 'values' | 'free';
const widthKind = (rule: WidthRule): WidthKind =>
  'free' in rule ? 'free' : 'values' in rule ? 'values' : 'range';

const widthRuleFor = (kind: WidthKind, entry: CatalogEntry): WidthRule => {
  const at = entry.defaultSize.width;
  if (kind === 'values') return { values: [at] };
  if (kind === 'free') return { free: { min: at, max: at } };
  return { min: at, max: at, step: 48 };
};

const refuse = (message: string | null) => message;

function WidthEditor({ entry, onChange }: Pick<Props, 'entry' | 'onChange'>) {
  const rule = entry.width;
  const set = (width: WidthRule) => onChange({ ...entry, width });
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Widths</legend>
      <SelectField
        label="Comes in"
        value={widthKind(rule)}
        options={[
          { value: 'range', label: 'A range in steps' },
          { value: 'values', label: 'A list of widths' },
          ...(entry.kind === 'filler' ? [{ value: 'free', label: 'Any width (filler)' }] : []),
        ]}
        onChange={(kind) => set(widthRuleFor(kind as WidthKind, entry))}
      />
      {'min' in rule && (
        <div className="grid grid-cols-3 gap-2">
          <LengthField
            label="Narrowest"
            value={rule.min}
            onCommit={(min) => (set({ ...rule, min }), refuse(null))}
          />
          <LengthField
            label="Widest"
            value={rule.max}
            onCommit={(max) => (set({ ...rule, max }), refuse(null))}
          />
          <LengthField
            label="Step"
            value={rule.step}
            onCommit={(step) => (set({ ...rule, step }), refuse(null))}
          />
        </div>
      )}
      {'values' in rule && (
        <LengthListField
          label="Widths (separated by commas)"
          value={rule.values}
          onCommit={(values) => set({ values })}
        />
      )}
      {'free' in rule && (
        <div className="grid grid-cols-2 gap-2">
          <LengthField
            label="Narrowest"
            value={rule.free.min}
            onCommit={(min) => (set({ free: { ...rule.free, min } }), refuse(null))}
          />
          <LengthField
            label="Widest"
            value={rule.free.max}
            onCommit={(max) => (set({ free: { ...rule.free, max } }), refuse(null))}
          />
        </div>
      )}
    </fieldset>
  );
}

const optionValues = (def: OptionDef): string =>
  def.type === 'bool'
    ? 'true, false'
    : 'values' in def
      ? def.values.join(', ')
      : `${def.range.min} to ${def.range.max}`;

function OptionEditor({
  def,
  onChange,
  onRemove,
}: {
  def: OptionDef;
  onChange(def: OptionDef): void;
  onRemove(): void;
}) {
  const list = (text: string) =>
    text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  const defaults = allowedOptionValues(def).map(String);
  return (
    <li className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-2">
        <CommitField
          label="Option key"
          value={def.key}
          onCommit={(key) => (onChange({ ...def, key: key.trim() }), null)}
        />
        {def.type === 'enum' && (
          <CommitField
            label="Values (separated by commas)"
            value={def.values.join(', ')}
            onCommit={(text) => {
              const values = list(text);
              onChange({
                ...def,
                values,
                default: values.includes(def.default) ? def.default : (values[0] ?? ''),
              });
              return null;
            }}
          />
        )}
        {def.type === 'int' && 'values' in def && (
          <CommitField
            label="Values (separated by commas)"
            value={def.values.join(', ')}
            onCommit={(text) => {
              const values = list(text).map(Number);
              if (values.some((value) => !Number.isInteger(value))) return 'Use whole numbers.';
              onChange({
                ...def,
                values,
                default: values.includes(def.default) ? def.default : (values[0] ?? 0),
              });
              return null;
            }}
          />
        )}
        {def.type === 'int' && 'range' in def && (
          <CommitField
            label="Range (least to greatest)"
            value={optionValues(def)}
            onCommit={(text) => {
              const match = /^\s*(-?\d+)\s*(?:to|-|,)\s*(-?\d+)\s*$/.exec(text);
              if (!match) return 'Write it like 1 to 4.';
              onChange({ ...def, range: { min: Number(match[1]), max: Number(match[2]) } });
              return null;
            }}
          />
        )}
        {def.type === 'bool' && <p className="self-end text-sm text-slate-600">On or off</p>}
      </div>
      <div className="flex items-end gap-3">
        {def.type === 'bool' ? (
          <CheckboxField
            label="On by default"
            checked={def.default}
            onChange={(value) => onChange({ ...def, default: value })}
          />
        ) : (
          <SelectField
            label="Default"
            value={String(def.default)}
            options={defaults.map((value) => ({ value, label: value }))}
            onChange={(value) =>
              onChange(
                def.type === 'enum'
                  ? { ...def, default: value }
                  : ({ ...def, default: Number(value) } as OptionDef),
              )
            }
          />
        )}
        <button
          type="button"
          className="ml-auto text-sm text-red-700 underline"
          aria-label={`Remove option ${def.key}`}
          onClick={onRemove}
        >
          Remove option
        </button>
      </div>
    </li>
  );
}

function PriceEditor({ entry, onChange }: Pick<Props, 'entry' | 'onChange'>) {
  const { price } = entry;
  const setPrice = (next: Partial<CatalogEntry['price']>) =>
    onChange({ ...entry, price: { ...price, ...next } });
  const optionCents = price.optionCents ?? {};
  const rows = entry.options.flatMap((def) =>
    allowedOptionValues(def)
      .slice(0, 12)
      .map((value) => `${def.key}=${String(value)}`),
  );
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Price</legend>
      <div className="grid grid-cols-2 gap-2">
        <MoneyField
          label="Base price ($)"
          cents={price.baseCents}
          onCommit={(baseCents) => setPrice({ baseCents })}
        />
        <MoneyField
          label="Per inch of width ($)"
          cents={price.perInchWidthCents}
          onCommit={(perInchWidthCents) => setPrice({ perInchWidthCents })}
        />
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {rows.map((key) => (
            <MoneyField
              key={key}
              label={`Add for ${key} ($)`}
              cents={optionCents[key] ?? 0}
              onCommit={(cents) => {
                const next = { ...optionCents };
                if (cents === 0) delete next[key];
                else next[key] = cents;
                // Keep the price of an option value that no longer exists out of sight, but
                // never silently: validation names it.
                setPrice({ optionCents: next });
              }}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}

const PLACEMENTS = ['wall', 'free'] as const;

/** Everything about one entry, edited in place. The caller keeps the catalog. */
export function EntryForm({ entry, problems, onChange }: Props) {
  const size = (key: keyof CatalogEntry['defaultSize'], value: Len) =>
    onChange({ ...entry, defaultSize: { ...entry.defaultSize, [key]: value } });
  return (
    <div className="flex flex-col gap-4" aria-label={`Entry ${entry.id}`} role="group">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{entry.id}</h2>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
          {entry.kind}
        </span>
        {entry.retired && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Retired</span>
        )}
      </div>

      {problems.length > 0 && (
        <ul
          aria-label="Problems with this entry"
          className="list-disc rounded border border-red-200 bg-red-50 py-2 pr-3 pl-7 text-sm text-red-800"
        >
          {problems.map((problem) => (
            <li key={`${problem.path}:${problem.message}`}>{problem.message}</li>
          ))}
        </ul>
      )}

      <CommitField
        label="Name"
        value={entry.name}
        onCommit={(name) => (onChange({ ...entry, name: name.trim() }), null)}
      />
      <CheckboxField
        label="Retired (stays in existing designs, cannot be added to new ones)"
        checked={entry.retired === true}
        onChange={(retired) => onChange(withRetired(entry, retired))}
      />

      <WidthEditor entry={entry} onChange={onChange} />
      <div className="grid grid-cols-2 gap-2">
        <LengthListField
          label="Heights (separated by commas)"
          value={entry.heights}
          onCommit={(heights) => onChange({ ...entry, heights })}
        />
        <LengthListField
          label="Depths (separated by commas)"
          value={entry.depths}
          onCommit={(depths) => onChange({ ...entry, depths })}
        />
      </div>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-600">Default size</legend>
        <div className="grid grid-cols-4 gap-2">
          <LengthField
            label="Default width"
            value={entry.defaultSize.width}
            onCommit={(value) => (size('width', value), null)}
          />
          <LengthField
            label="Default height"
            value={entry.defaultSize.height}
            onCommit={(value) => (size('height', value), null)}
          />
          <LengthField
            label="Default depth"
            value={entry.defaultSize.depth}
            onCommit={(value) => (size('depth', value), null)}
          />
          <LengthField
            label="Default elevation"
            value={entry.defaultElevation}
            onCommit={(defaultElevation) => (onChange({ ...entry, defaultElevation }), null)}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-600">Placement</legend>
        <div className="flex gap-4">
          {PLACEMENTS.map((placement) => (
            <CheckboxField
              key={placement}
              label={placement === 'wall' ? 'On a wall' : 'Free-standing'}
              checked={entry.placement.includes(placement)}
              onChange={(on) =>
                onChange({
                  ...entry,
                  placement: PLACEMENTS.filter((p) =>
                    p === placement ? on : entry.placement.includes(p),
                  ),
                })
              }
            />
          ))}
        </div>
        {entry.kind === 'corner' && (
          <SelectField
            label="Corner shape"
            value={entry.corner ?? 'blind'}
            options={[
              { value: 'blind', label: 'Blind' },
              { value: 'l', label: 'L-shaped' },
              { value: 'diagonal', label: 'Diagonal' },
            ]}
            onChange={(corner) =>
              onChange({ ...entry, corner: corner as 'blind' | 'l' | 'diagonal' })
            }
          />
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-600">Options</legend>
        {entry.options.length === 0 && <p className="text-sm text-slate-600">No options.</p>}
        <ul className="flex flex-col gap-2">
          {entry.options.map((def, index) => (
            <OptionEditor
              key={index}
              def={def}
              onChange={(next) =>
                onChange({
                  ...entry,
                  options: entry.options.map((d, i) => (i === index ? next : d)),
                })
              }
              onRemove={() =>
                onChange({ ...entry, options: entry.options.filter((_, i) => i !== index) })
              }
            />
          ))}
        </ul>
        <div className="flex gap-2">
          {(
            [
              ['Add a yes/no option', { type: 'bool', default: false }],
              ['Add a choice option', { type: 'enum', values: ['a', 'b'], default: 'a' }],
              ['Add a number option', { type: 'int', values: [1, 2], default: 1 }],
            ] as const
          ).map(([label, shape]) => (
            <button
              key={label}
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100"
              onClick={() =>
                onChange({
                  ...entry,
                  options: [
                    ...entry.options,
                    { key: `option${entry.options.length + 1}`, ...shape } as OptionDef,
                  ],
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <PriceEditor entry={entry} onChange={onChange} />
    </div>
  );
}

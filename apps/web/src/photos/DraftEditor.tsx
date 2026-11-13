import {
  allowedWidths,
  type Catalog,
  CATEGORY_CATALOG_IDS,
  CATEGORY_NAMES,
  DEFAULT_OPENING_SIZE,
  type DraftCategory,
  type DraftItem,
  type DraftLen,
  type DraftOpening,
  draftOpeningName,
  DRAFT_SHAPES,
  type DraftShape,
  formatLength,
  getEntry,
  nearestAllowedWidth,
  type OpeningKind,
  parseLength,
  type RoomDraft,
  setDraftShape,
} from '@ezd/core';
import { useId, useState } from 'react';

import { BUTTON } from '../editor/panels/fields';

// The editable draft room. Every value the model supplied is shown as a suggestion (a
// dashed outline and an Estimated tag) until the user types it or ticks it. Wall lengths
// must all be typed or ticked before Confirm is enabled.

const CONTROL =
  'w-full rounded border bg-white px-2 py-1 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500';
const SECTION = 'flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm';
const HEADING = 'text-sm font-semibold text-slate-800';

const typed = (value: number): DraftLen => ({ value, estimated: false });
const UNKNOWN: DraftLen = { value: null, estimated: false };

/**
 * A length of the draft, typed in inches. Empty is unknown. An estimate has a dashed
 * outline, an Estimated tag and a button to accept it as it is.
 */
export function DraftLengthField({
  label,
  value,
  lowConfidence = false,
  onChange,
}: {
  label: string;
  value: DraftLen;
  lowConfidence?: boolean;
  onChange(value: DraftLen): void;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = text ?? (value.value === null ? '' : formatLength(value.value));
  const estimate = value.estimated && value.value !== null;

  const commit = () => {
    if (text === null) return;
    if (text.trim() === '') {
      onChange(UNKNOWN);
    } else {
      const parsed = parseLength(text);
      if (!parsed.ok) {
        setError(parsed.error.message);
        return;
      }
      onChange(typed(parsed.value));
    }
    setText(null);
    setError(null);
  };

  const border = estimate
    ? `border-dashed ${lowConfidence ? 'border-amber-500 bg-amber-50' : 'border-sky-500'}`
    : 'border-slate-300';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        {estimate && (
          <span
            className={`rounded px-1.5 text-[11px] font-medium ${
              lowConfidence ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'
            }`}
          >
            Estimated{lowConfidence ? ', low confidence' : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="inches"
          className={`${CONTROL} ${border}`}
          value={shown}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
        {estimate && (
          <button
            type="button"
            className={BUTTON}
            title="This value is right"
            onClick={() => onChange(typed(value.value!))}
          >
            <span aria-hidden="true">✓</span>
            <span className="sr-only">Confirm {label}</span>
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={id}
        className={`${CONTROL} border-slate-300`}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const KINDS: { value: OpeningKind; label: string }[] = [
  { value: 'door', label: 'Door' },
  { value: 'window', label: 'Window' },
  { value: 'passage', label: 'Open passage' },
];
const CATEGORIES = (Object.keys(CATEGORY_NAMES) as DraftCategory[]).map((value) => ({
  value,
  label: CATEGORY_NAMES[value],
}));

/** The item as another category: the catalog entry's sizes, the width kept if allowed. */
function withCategory(item: DraftItem, category: DraftCategory, catalog: Catalog): DraftItem {
  const entry = getEntry(catalog, CATEGORY_CATALOG_IDS[category]);
  if (!entry) return item;
  const width = nearestAllowedWidth(entry, item.width.value ?? entry.defaultSize.width);
  return {
    ...item,
    category,
    catalogId: entry.id,
    kind: entry.kind,
    width: { value: width, estimated: item.width.estimated || width !== item.width.value },
    height: entry.defaultSize.height,
    depth: entry.defaultSize.depth,
    elevation: entry.defaultElevation,
  };
}

function newOpening(wall: string): DraftOpening {
  return {
    wall,
    kind: 'door',
    offset: UNKNOWN,
    width: UNKNOWN,
    height: typed(DEFAULT_OPENING_SIZE.door.height),
    sillHeight: typed(0),
    confidence: 'high',
  };
}

function withKind(opening: DraftOpening, kind: OpeningKind): DraftOpening {
  const sill = kind === 'window' ? typed(DEFAULT_OPENING_SIZE.window.sillHeight) : typed(0);
  return { ...opening, kind, sillHeight: kind === opening.kind ? opening.sillHeight : sill };
}

export function DraftEditor({
  draft,
  catalog,
  onChange,
}: {
  draft: RoomDraft;
  catalog: Catalog;
  onChange(draft: RoomDraft): void;
}) {
  const walls = draft.walls.map((wall) => ({ value: wall.label, label: `Wall ${wall.label}` }));
  const firstWall = draft.walls[0]?.label ?? 'A';
  const shapes: { value: DraftShape; label: string }[] = [
    ...(draft.shape === 'unknown' ? [{ value: 'unknown' as const, label: 'Not sure yet' }] : []),
    ...DRAFT_SHAPES.map(({ shape, name }) => ({ value: shape, label: name })),
  ];
  const setOpening = (index: number, opening: DraftOpening) =>
    onChange({ ...draft, openings: draft.openings.map((o, i) => (i === index ? opening : o)) });
  const setItem = (index: number, item: DraftItem) =>
    onChange({ ...draft, items: draft.items.map((it, i) => (i === index ? item : it)) });

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Room" className={SECTION}>
        <h2 className={HEADING}>Room</h2>
        <Select
          label="Shape"
          value={draft.shape}
          options={shapes}
          onChange={(shape) => onChange(setDraftShape(draft, shape))}
        />
        <div className="grid grid-cols-2 gap-2">
          {draft.walls.map((wall, index) => (
            <DraftLengthField
              key={wall.label}
              label={`Wall ${wall.label} length`}
              value={wall.length}
              lowConfidence={wall.confidence === 'low'}
              onChange={(length) =>
                onChange({
                  ...draft,
                  walls: draft.walls.map((w, i) => (i === index ? { ...w, length } : w)),
                })
              }
            />
          ))}
          {draft.shape === 'galley' && (
            <DraftLengthField
              label="Distance between walls A and B"
              value={draft.galleyWidth}
              onChange={(galleyWidth) => onChange({ ...draft, galleyWidth })}
            />
          )}
          <DraftLengthField
            label="Ceiling height"
            value={draft.ceilingHeight}
            onChange={(ceilingHeight) => onChange({ ...draft, ceilingHeight })}
          />
        </div>
      </section>

      <section aria-label="Doors and windows" className={SECTION}>
        <h2 className={HEADING}>Doors and windows</h2>
        {draft.openings.length === 0 && (
          <p className="text-xs text-slate-500">None found. Add any the photo does not show.</p>
        )}
        <ul className="flex flex-col gap-2">
          {draft.openings.map((opening, index) => {
            const name = draftOpeningName(draft, index);
            const low = opening.confidence === 'low';
            return (
              <li
                key={index}
                aria-label={name}
                className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-4"
              >
                <Select
                  label="Kind"
                  value={opening.kind}
                  options={KINDS}
                  onChange={(kind) => setOpening(index, withKind(opening, kind))}
                />
                <Select
                  label="Wall"
                  value={opening.wall}
                  options={walls}
                  onChange={(wall) => setOpening(index, { ...opening, wall })}
                />
                <DraftLengthField
                  label="Offset"
                  value={opening.offset}
                  lowConfidence={low}
                  onChange={(offset) => setOpening(index, { ...opening, offset })}
                />
                <DraftLengthField
                  label="Width"
                  value={opening.width}
                  lowConfidence={low}
                  onChange={(width) => setOpening(index, { ...opening, width })}
                />
                <DraftLengthField
                  label="Height"
                  value={opening.height}
                  onChange={(height) => setOpening(index, { ...opening, height })}
                />
                {opening.kind === 'window' && (
                  <DraftLengthField
                    label="Sill height"
                    value={opening.sillHeight}
                    onChange={(sillHeight) => setOpening(index, { ...opening, sillHeight })}
                  />
                )}
                <div className="flex items-end">
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() =>
                      onChange({ ...draft, openings: draft.openings.filter((_, i) => i !== index) })
                    }
                  >
                    Remove<span className="sr-only"> {name.toLowerCase()}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <button
            type="button"
            className={BUTTON}
            onClick={() =>
              onChange({ ...draft, openings: [...draft.openings, newOpening(firstWall)] })
            }
          >
            Add a door or window
          </button>
        </div>
      </section>

      <section aria-label="Cabinets and appliances" className={SECTION}>
        <h2 className={HEADING}>Cabinets and appliances</h2>
        {draft.items.length === 0 && (
          <p className="text-xs text-slate-500">None found. You can add them in the editor.</p>
        )}
        <ul className="flex flex-col gap-2">
          {draft.items.map((item, index) => {
            const entry = getEntry(catalog, item.catalogId);
            const widths = entry ? allowedWidths(entry) : [];
            const label = `${CATEGORY_NAMES[item.category]} ${index + 1}`;
            const estimated = item.width.estimated;
            return (
              <li
                key={index}
                aria-label={label}
                className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-4"
              >
                <Select
                  label="Kind"
                  value={item.category}
                  options={CATEGORIES}
                  onChange={(category) => setItem(index, withCategory(item, category, catalog))}
                />
                <Select
                  label="Wall"
                  value={item.wall}
                  options={walls}
                  onChange={(wall) => setItem(index, { ...item, wall })}
                />
                <DraftLengthField
                  label="Offset"
                  value={item.offset}
                  lowConfidence={item.confidence === 'low'}
                  onChange={(offset) => setItem(index, { ...item, offset })}
                />
                <div className="flex flex-col gap-1">
                  <WidthSelect
                    label="Width"
                    value={item.width.value}
                    widths={widths}
                    estimated={estimated}
                    onChange={(width) => setItem(index, { ...item, width: typed(width) })}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() =>
                      onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })
                    }
                  >
                    Remove<span className="sr-only"> {label.toLowerCase()}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              const entry = getEntry(catalog, CATEGORY_CATALOG_IDS.base);
              if (!entry) return;
              const item: DraftItem = {
                wall: firstWall,
                category: 'base',
                catalogId: entry.id,
                kind: entry.kind,
                offset: UNKNOWN,
                width: typed(entry.defaultSize.width),
                height: entry.defaultSize.height,
                depth: entry.defaultSize.depth,
                elevation: entry.defaultElevation,
                confidence: 'high',
              };
              onChange({ ...draft, items: [...draft.items, item] });
            }}
          >
            Add a cabinet
          </button>
        </div>
      </section>
    </div>
  );
}

/** A cabinet width, picked from the widths its catalog entry comes in. */
function WidthSelect({
  label,
  value,
  widths,
  estimated,
  onChange,
}: {
  label: string;
  value: number | null;
  widths: number[];
  estimated: boolean;
  onChange(width: number): void;
}) {
  const id = useId();
  return (
    <>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        {estimated && (
          <span className="rounded bg-sky-100 px-1.5 text-[11px] font-medium text-sky-900">
            Estimated
          </span>
        )}
      </div>
      <select
        id={id}
        className={`${CONTROL} ${estimated ? 'border-dashed border-sky-500' : 'border-slate-300'}`}
        value={value ?? ''}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {value === null && <option value="">Pick a width</option>}
        {widths.map((width) => (
          <option key={width} value={width}>
            {formatLength(width)}
          </option>
        ))}
      </select>
    </>
  );
}

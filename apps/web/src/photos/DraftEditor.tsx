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
import { CheckIcon, PlusIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';

// The editable draft room. Every value the model supplied is shown as a suggestion (a
// dashed outline and an Estimated tag) until the user types it or ticks it. Wall lengths
// must all be typed or ticked before Confirm is enabled.

const ITEM_ROW = 'grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4';

/** A titled card; `aria-label` makes it a landmark the tests and screen readers can name. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{label}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </section>
  );
}

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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {estimate && (
          <Badge variant={lowConfidence ? 'warning' : 'secondary'}>
            Estimated{lowConfidence ? ', low confidence' : ''}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="inches"
          className={cn(
            estimate && 'border-dashed',
            estimate && (lowConfidence ? 'border-warning' : 'border-info'),
          )}
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
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="This value is right"
            onClick={() => onChange(typed(value.value!))}
          >
            <CheckIcon aria-hidden="true" />
            <span className="sr-only">Confirm {label}</span>
          </Button>
        )}
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
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
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
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
      <Section label="Room">
        <Select
          label="Shape"
          value={draft.shape}
          options={shapes}
          onChange={(shape) => onChange(setDraftShape(draft, shape))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
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
      </Section>

      <Section label="Doors and windows">
        {draft.openings.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None found. Add any the photo does not show.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {draft.openings.map((opening, index) => {
            const name = draftOpeningName(draft, index);
            const low = opening.confidence === 'low';
            return (
              <li key={index} aria-label={name} className={ITEM_ROW}>
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onChange({ ...draft, openings: draft.openings.filter((_, i) => i !== index) })
                    }
                  >
                    Remove<span className="sr-only"> {name.toLowerCase()}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange({ ...draft, openings: [...draft.openings, newOpening(firstWall)] })
            }
          >
            <PlusIcon aria-hidden="true" />
            Add a door or window
          </Button>
        </div>
      </Section>

      <Section label="Cabinets and appliances">
        {draft.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None found. You can add them in the editor.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {draft.items.map((item, index) => {
            const entry = getEntry(catalog, item.catalogId);
            const widths = entry ? allowedWidths(entry) : [];
            const label = `${CATEGORY_NAMES[item.category]} ${index + 1}`;
            const estimated = item.width.estimated;
            return (
              <li key={index} aria-label={label} className={ITEM_ROW}>
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })
                    }
                  >
                    Remove<span className="sr-only"> {label.toLowerCase()}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <Button
            type="button"
            variant="outline"
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
            <PlusIcon aria-hidden="true" />
            Add a cabinet
          </Button>
        </div>
      </Section>
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
      <div className="flex flex-wrap items-center gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {estimated && <Badge variant="secondary">Estimated</Badge>}
      </div>
      <NativeSelect
        id={id}
        className={cn(estimated && 'border-dashed border-info')}
        value={value ?? ''}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {value === null && <option value="">Pick a width</option>}
        {widths.map((width) => (
          <option key={width} value={width}>
            {formatLength(width)}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

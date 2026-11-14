import {
  activeEntries,
  allowedWidths,
  type CatalogEntry,
  formatLength,
  type Len,
  parseLength,
} from '@ezd/core';
import { PlusIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useConfig } from '../../config/useConfig';
import { useDesign, useDesignStore } from '../../store/context';
import { freeSpot, newItem } from '../edits';
import { newId } from '../ids';
import { itemCode } from '../labels';
import { PanelSection } from './fields';

/** The seed names say how a corner cabinet is measured, in brackets. Leave that out. */
const shortName = (entry: CatalogEntry): string => entry.name.replace(/\s*\(.*\)$/, '');

function CatalogRow({
  entry,
  onAdded,
}: {
  entry: CatalogEntry;
  onAdded?: (() => void) | undefined;
}) {
  const store = useDesignStore();
  const id = useId();
  const free = 'free' in entry.width ? entry.width.free : null;
  const [width, setWidth] = useState<Len>(entry.defaultSize.width);
  const [text, setText] = useState(formatLength(entry.defaultSize.width));
  const [error, setError] = useState<string | null>(null);
  const name = shortName(entry);
  const item = () => newItem(entry, width, newId('item'));

  /** A filler comes at any width in its range, so its width is typed. */
  const typeWidth = (value: string) => {
    setText(value);
    const parsed = parseLength(value);
    if (!parsed.ok) {
      setError(parsed.error.message);
    } else if (free && (parsed.value < free.min || parsed.value > free.max)) {
      setError(`Use ${formatLength(free.min)} to ${formatLength(free.max)}.`);
    } else {
      setError(null);
      setWidth(parsed.value);
    }
  };

  /** The keyboard path: puts the item in the first free stretch of wall. */
  const add = () => {
    const state = store.getState();
    const added = item();
    const placement = freeSpot(state.doc, state.catalog, added);
    if (!placement) {
      state.notify(`Draw a wall first: ${name.toLowerCase()} goes against a wall.`);
      return;
    }
    const executed = state.execute({ type: 'item.add', item: { ...added, placement } });
    if (executed.ok) state.select([added.id]);
    state.notify(executed.ok ? null : executed.error.message);
    if (executed.ok) onAdded?.();
  };

  return (
    <li className="border-b px-3 py-2">
      <div
        data-testid={`catalog-${entry.id}`}
        title="Drag onto the canvas"
        className="flex cursor-grab touch-none items-center justify-between gap-2 rounded-md px-1 py-0.5 select-none hover:bg-accent active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0 || error) return;
          // Stops the browser from selecting text while the item is dragged.
          event.preventDefault();
          store.getState().select([]);
          store.getState().startDrag({ kind: 'add', item: item(), snap: null });
        }}
      >
        <span className="text-sm">{name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {itemCode({ ...entry.defaultSize, catalogId: entry.id, kind: entry.kind, width })}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 px-1">
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
          Width
        </Label>
        {free ? (
          <Input
            id={id}
            type="text"
            inputMode="decimal"
            className="h-7 w-20 text-xs md:text-xs"
            value={text}
            aria-invalid={error !== null}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => typeWidth(event.target.value)}
          />
        ) : (
          <NativeSelect
            id={id}
            className="h-7 text-xs md:text-xs pointer-coarse:h-11"
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
          >
            {allowedWidths(entry).map((choice) => (
              <option key={choice} value={choice}>
                {formatLength(choice)}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button
          variant="outline"
          size="xs"
          className="ml-auto"
          disabled={error !== null}
          aria-label={`Add ${name}`}
          onClick={add}
        >
          <PlusIcon aria-hidden="true" />
          Add
        </Button>
      </div>
      {error && (
        <FieldError id={`${id}-error`} className="mt-1 px-1 text-xs">
          {error}
        </FieldError>
      )}
    </li>
  );
}

/** The catalog, grouped by kind and filtered by the search box. Entries drag onto the canvas. */
export function CatalogPanel({ onAdded }: { onAdded?: (() => void) | undefined } = {}) {
  const catalog = useDesign((state) => state.catalog);
  const { order, groups: groupConfig } = useConfig().panels.catalog;
  const [query, setQuery] = useState('');
  const searchId = useId();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (entry: CatalogEntry) => {
    const text = `${entry.name} ${entry.id} ${entry.kind}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const groups = order
    .filter((kind) => groupConfig[kind].visible)
    .map((kind) => ({ kind, title: groupConfig[kind].title }))
    .map((group) => ({
      ...group,
      entries: activeEntries(catalog).filter(
        (entry) => entry.kind === group.kind && matches(entry),
      ),
    }))
    .filter((group) => group.entries.length > 0);

  return (
    <PanelSection title="Catalog">
      <div className="border-b p-3">
        <Label htmlFor={searchId} className="sr-only">
          Search the catalog
        </Label>
        <Input
          id={searchId}
          type="search"
          placeholder="Search the catalog"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="overflow-y-auto">
        {groups.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">Nothing in the catalog matches.</p>
        )}
        {groups.map((group) => (
          <section key={group.kind} aria-label={group.title}>
            <h3 className="bg-muted px-3 py-1 text-xs font-semibold">{group.title}</h3>
            <ul>
              {group.entries.map((entry) => (
                <CatalogRow key={entry.id} entry={entry} onAdded={onAdded} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PanelSection>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { type AuditChange, type VersionDiff } from '../api/client';
import { versionDiffKey } from '../api/keys';
import { errorMessage } from '../pages/format';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { ChangeList } from './changes';

const SECTION_TITLES: Record<string, string> = {
  app_config: 'App settings',
  rules_config: 'Rules',
  quote_defaults: 'Quote defaults',
  catalog: 'Catalog',
};

/**
 * Compares any two published versions: pick both, and the changes are listed section by
 * section. `load` reads the difference, and `label` says what a version is called.
 */
export function VersionCompare({
  kind,
  numbers,
  label,
  load,
}: {
  kind: 'config' | 'catalog';
  /** The version numbers there are, newest first. */
  numbers: number[];
  label: (number: number) => string;
  load: (from: number, to: number) => Promise<VersionDiff>;
}) {
  const id = useId();
  // Until one is chosen, compare the newest version with the one before it. The list arrives
  // after this mounts, so the defaults are read from it on each render, not once.
  const [chosenFrom, setFrom] = useState<number | null>(null);
  const [chosenTo, setTo] = useState<number | null>(null);
  const from = chosenFrom ?? numbers[1] ?? numbers[0] ?? 0;
  const to = chosenTo ?? numbers[0] ?? 0;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<[number, number] | null>(null);
  const diff = useQuery({
    queryKey: versionDiffKey(kind, shown?.[0] ?? 0, shown?.[1] ?? 0),
    queryFn: () => load(shown![0], shown![1]),
    enabled: shown !== null,
  });
  if (numbers.length < 2) return null;
  if (!open) {
    return (
      <div className="mt-4 border-t pt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Compare versions…
        </Button>
      </div>
    );
  }
  const options = numbers.map((number) => (
    <option key={number} value={number}>
      {label(number)}
    </option>
  ));
  return (
    <section aria-label="Compare versions" className="mt-4 flex flex-col gap-3 border-t pt-3">
      <h3 className="text-sm font-semibold">Compare two versions</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${id}-from`}>
          From
          <NativeSelect
            id={`${id}-from`}
            value={from}
            onChange={(event) => setFrom(Number(event.target.value))}
          >
            {options}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${id}-to`}>
          To
          <NativeSelect
            id={`${id}-to`}
            value={to}
            onChange={(event) => setTo(Number(event.target.value))}
          >
            {options}
          </NativeSelect>
        </label>
        <Button type="button" variant="outline" onClick={() => setShown([from, to])}>
          Show changes
        </Button>
      </div>
      <div role={shown ? 'status' : undefined} aria-live="polite">
        {shown && diff.isPending && <p className="text-sm text-muted-foreground">Comparing…</p>}
        {diff.error && <p className="text-sm text-destructive">{errorMessage(diff.error)}</p>}
        {diff.data &&
          Object.entries(diff.data.sections).map(([section, changes]) => (
            <div key={section} className="mb-3">
              <h4 className="mb-1 text-sm font-medium">{SECTION_TITLES[section] ?? section}</h4>
              <ChangeList
                label={`Changes to ${SECTION_TITLES[section] ?? section}`}
                changes={changes as AuditChange[]}
              />
            </div>
          ))}
      </div>
    </section>
  );
}

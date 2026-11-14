import { useQuery } from '@tanstack/react-query';

import type { DryRun, DryRunResult } from '../api/client';
import { errorMessage } from '../pages/format';

type Sample = {
  id: string;
  name: string;
  introduced?: string[];
  cleared?: string[];
  missing?: string[];
};

function Report({ title, report }: { title: string; report: DryRun }) {
  if (report.sampled === 0) return null;
  const of =
    report.total > report.sampled ? ` (the ${report.sampled} most recent of ${report.total})` : '';
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-sm">
        {report.changed === 0
          ? `None of the ${report.sampled} checked would change${of}.`
          : `${report.changed} of ${report.sampled} checked would change${of}.`}
      </p>
      {report.changed > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {(report.samples as Sample[]).map((sample) => (
            <li key={sample.id}>
              <strong className="text-foreground">{sample.name || sample.id}</strong>
              {sample.introduced?.map((message) => (
                <span key={message} className="block">
                  New problem: {message}
                </span>
              ))}
              {sample.cleared?.map((message) => (
                <span key={message} className="block">
                  No longer a problem: {message}
                </span>
              ))}
              {sample.missing && (
                <span className="block">No longer offered: {sample.missing.join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The dry run before a publish: how many existing designs and quotes would be checked
 * differently under the saved draft. It only informs; publishing is not blocked by it.
 */
export function DryRunSummary({
  queryKey,
  run,
  unsaved,
}: {
  queryKey: readonly unknown[];
  run: () => Promise<DryRunResult>;
  /** The form has edits that are not saved, so the server cannot have counted them. */
  unsaved: boolean;
}) {
  const result = useQuery({ queryKey, queryFn: run, gcTime: 0, staleTime: 0 });
  return (
    <section
      aria-label="Effect on existing work"
      className="flex flex-col gap-2 rounded-md border p-3"
    >
      <h3 className="text-sm font-semibold">Effect on existing designs and quotes</h3>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {result.isPending && (
          <p className="text-sm text-muted-foreground">Checking existing designs…</p>
        )}
        {result.error && (
          <p className="text-sm text-destructive">
            The check could not run: {errorMessage(result.error)}
          </p>
        )}
        {result.data && (
          <>
            {result.data.designs.sampled === 0 && result.data.quotes.sampled === 0 && (
              <p className="text-sm">There are no designs or quotes to check.</p>
            )}
            <Report title="Designs" report={result.data.designs} />
            <Report title="Quotes" report={result.data.quotes} />
          </>
        )}
      </div>
      {unsaved && (
        <p className="text-xs text-muted-foreground">
          This is the saved draft: edits you have not saved are not counted.
        </p>
      )}
    </section>
  );
}

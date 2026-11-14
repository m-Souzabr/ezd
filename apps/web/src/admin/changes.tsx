import type { AuditChange } from '../api/client';
import { Badge } from '@/components/ui/badge';

/** A value as one line of text. Objects and lists are JSON, shortened if long. */
function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

const KIND: Record<AuditChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

/**
 * The fields that differ between two states, as a list: the path, what happened in words (not
 * only a color), and the old and new value. Secrets are masked by the server before they get here.
 */
export function ChangeList({ changes, label }: { changes: AuditChange[]; label: string }) {
  if (changes.length === 0) return <p className="text-sm text-muted-foreground">No changes.</p>;
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-border text-sm">
      {changes.map((change) => (
        <li key={`${change.path}-${change.kind}`} className="flex flex-col gap-0.5 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND[change.kind]}</Badge>
            <code className="break-all text-xs">{change.path}</code>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 text-xs text-muted-foreground">
            {change.kind !== 'added' && (
              <>
                <span>Before</span>
                <span className="break-all">{formatValue(change.before)}</span>
              </>
            )}
            {change.kind !== 'removed' && (
              <>
                <span>After</span>
                <span className="break-all">{formatValue(change.after)}</span>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

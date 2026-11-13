import { BUTTON } from '../editor/panels/fields';

export const FIELD =
  'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500';

/** Previous and next for a list read a page at a time. */
export function Pager({
  offset,
  limit,
  total,
  onOffset,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffset(offset: number): void;
}) {
  if (total <= limit)
    return total > 0 ? <p className="mt-2 text-xs text-slate-500">{total} in all</p> : null;
  const last = Math.min(offset + limit, total);
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center gap-3 text-sm text-slate-700">
      <button
        type="button"
        className={BUTTON}
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span>
        {offset + 1} to {last} of {total}
      </span>
      <button
        type="button"
        className={BUTTON}
        disabled={last >= total}
        onClick={() => onOffset(offset + limit)}
      >
        Next
      </button>
    </nav>
  );
}

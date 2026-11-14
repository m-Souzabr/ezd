import { Button } from '@/components/ui/button';

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
    return total > 0 ? <p className="mt-2 text-xs text-muted-foreground">{total} in all</p> : null;
  const last = Math.min(offset + limit, total);
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
      <Button
        type="button"
        variant="outline"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        Previous
      </Button>
      <span>
        {offset + 1} to {last} of {total}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={last >= total}
        onClick={() => onOffset(offset + limit)}
      >
        Next
      </Button>
    </nav>
  );
}

import type { Catalog, DesignDocument } from '@ezd/core';
import { formatMoney } from '@ezd/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Button } from '@/components/ui/button';
import { api, isConflict, type QuoteSummary } from '../api/client';
import { quoteKey, quotesKey, versionsKey } from '../api/keys';
import { captureDrawings, type Drawings } from '../editor/capture';
import { useDesignStore } from '../store/context';
import { quoteDate } from './format';
import { useDownloadQuote } from './useDownloadQuote';
import { QuoteForm, type QuoteDraft } from './QuoteForm';

const LINK =
  'text-primary underline underline-offset-2 hover:text-primary/80 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function QuoteRow({ quote, onDelete }: { quote: QuoteSummary; onDelete(): void }) {
  const download = useDownloadQuote();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <Link to={`/quotes/${quote.id}`} className={`${LINK} font-medium`}>
        Quote {quote.number}
      </Link>
      <span>{quote.customer_name}</span>
      <span className="font-medium tabular-nums">{formatMoney(quote.total_cents)}</span>
      <span className="mr-auto text-xs text-muted-foreground">
        {quoteDate(quote.created_at)} · version {quote.design_version}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={download.isPending}
        aria-label={`Download PDF of quote ${quote.number}`}
        onClick={() => download.mutate(quote.id)}
      >
        Download PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Delete quote ${quote.number}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete quote ${quote.number}?`}
        description="The quote and its PDF are deleted for good. The design is not changed."
        confirmLabel="Delete for good"
        onConfirm={onDelete}
      />
      {download.error && (
        <p role="alert" className="w-full text-xs text-destructive">
          The PDF could not be made: {download.error.message}
        </p>
      )}
    </li>
  );
}

/**
 * The quotes of a design, and a form for a new one. A new quote is of the design as it is
 * saved: `beforeQuote` sends any unsaved change and returns the revision the server has.
 */
export function QuotesDialogBody({
  designId,
  open,
  onOpenChange: setOpen,
  beforeQuote,
  capture = captureDrawings,
}: {
  designId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  beforeQuote(): Promise<number>;
  /** How the drawings are made. Replaced in tests, which have no canvas. */
  capture?: (doc: DesignDocument, catalog: Catalog) => Promise<Drawings>;
}) {
  const store = useDesignStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: quotesKey(designId),
    queryFn: () => api.listQuotes(designId),
    enabled: open,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: quotesKey(designId) });
  const remove = useMutation({ mutationFn: api.deleteQuote, onSuccess: refresh });
  const create = useMutation({
    mutationFn: async (draft: QuoteDraft) => {
      const revision = await beforeQuote();
      const { doc, catalog } = store.getState();
      const drawings = await capture(doc, catalog);
      return api.createQuote(designId, { ...draft, draft_revision: revision, drawings });
    },
    onSuccess: (quote) => {
      queryClient.setQueryData(quoteKey(quote.id), quote);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: versionsKey(designId) });
      setOpen(false);
      void navigate(`/quotes/${quote.id}`);
    },
  });
  const createError = create.error
    ? isConflict(create.error)
      ? 'The design changed while the quote was being made. Try again.'
      : `The quote was not created: ${create.error.message}`
    : null;

  const close = (next: boolean) => {
    setOpen(next);
    setCreating(false);
    create.reset();
  };

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={close}
        title={creating ? 'New quote' : 'Quotes'}
        description={
          creating
            ? 'A quote prices the design as it is now, and keeps a copy of it as a version.'
            : 'A quote does not change after it is made. To change one, make another.'
        }
        showCloseButton={creating}
        footer={
          creating ? undefined : (
            <Button variant="outline" onClick={() => close(false)}>
              Close
            </Button>
          )
        }
      >
        {creating ? (
          <QuoteForm
            pending={create.isPending}
            error={createError}
            onSubmit={(draft) => create.mutate(draft)}
            onCancel={() => {
              setCreating(false);
              create.reset();
            }}
          />
        ) : (
          <>
            <div className="flex justify-end">
              <Button onClick={() => setCreating(true)}>New quote</Button>
            </div>
            {(list.error ?? remove.error) && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {(list.error ?? remove.error)!.message}
              </p>
            )}
            {list.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
            {list.data?.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">No quotes for this design yet.</p>
            )}
            <ul aria-label="Quotes" className="mt-2 divide-y">
              {list.data?.map((quote) => (
                <QuoteRow key={quote.id} quote={quote} onDelete={() => remove.mutate(quote.id)} />
              ))}
            </ul>
          </>
        )}
      </ResponsiveDialog>
    </>
  );
}

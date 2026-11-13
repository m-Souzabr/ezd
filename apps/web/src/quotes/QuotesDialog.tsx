import type { Catalog, DesignDocument } from '@ezd/core';
import { formatMoney } from '@ezd/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { api, isConflict, type QuoteSummary } from '../api/client';
import { quoteKey, quotesKey, versionsKey } from '../api/keys';
import { captureDrawings, type Drawings } from '../editor/capture';
import { BUTTON } from '../editor/panels/fields';
import { useDesignStore } from '../store/context';
import { quoteDate } from './format';
import { useDownloadQuote } from './useDownloadQuote';
import { QuoteForm, type QuoteDraft } from './QuoteForm';

const LINK =
  'text-sky-700 underline underline-offset-2 hover:text-sky-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';

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
      <span className="mr-auto text-xs text-slate-500">
        {quoteDate(quote.created_at)} · version {quote.design_version}
      </span>
      <button
        type="button"
        className={BUTTON}
        disabled={download.isPending}
        aria-label={`Download PDF of quote ${quote.number}`}
        onClick={() => download.mutate(quote.id)}
      >
        Download PDF
      </button>
      {confirming ? (
        <button
          type="button"
          className={`${BUTTON} border-red-300 text-red-800`}
          aria-label={`Confirm deleting quote ${quote.number}`}
          onClick={onDelete}
        >
          Delete for good
        </button>
      ) : (
        <button
          type="button"
          className={BUTTON}
          aria-label={`Delete quote ${quote.number}`}
          onClick={() => setConfirming(true)}
        >
          Delete
        </button>
      )}
      {download.error && (
        <p role="alert" className="w-full text-xs text-red-700">
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
export function QuotesDialog({
  designId,
  trigger,
  beforeQuote,
  capture = captureDrawings,
}: {
  designId: string;
  trigger: ReactNode;
  beforeQuote(): Promise<number>;
  /** How the drawings are made. Replaced in tests, which have no canvas. */
  capture?: (doc: DesignDocument, catalog: Catalog) => Promise<Drawings>;
}) {
  const store = useDesignStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setCreating(false);
        create.reset();
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[36rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold text-slate-900">
            {creating ? 'New quote' : 'Quotes'}
          </Dialog.Title>
          <Dialog.Description className="mt-1 mb-4 text-sm text-slate-600">
            {creating
              ? 'A quote prices the design as it is now, and keeps a copy of it as a version.'
              : 'A quote does not change after it is made. To change one, make another.'}
          </Dialog.Description>

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
                <button type="button" className={BUTTON} onClick={() => setCreating(true)}>
                  New quote
                </button>
              </div>
              {(list.error ?? remove.error) && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  {(list.error ?? remove.error)!.message}
                </p>
              )}
              {list.isPending && <p className="text-sm text-slate-600">Loading…</p>}
              {list.data?.length === 0 && (
                <p className="mt-2 text-sm text-slate-600">No quotes for this design yet.</p>
              )}
              <ul aria-label="Quotes" className="mt-2 divide-y divide-slate-200">
                {list.data?.map((quote) => (
                  <QuoteRow key={quote.id} quote={quote} onDelete={() => remove.mutate(quote.id)} />
                ))}
              </ul>
              <div className="mt-4 flex justify-end">
                <Dialog.Close asChild>
                  <button type="button" className={BUTTON}>
                    Close
                  </button>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

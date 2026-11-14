import { formatMoney, formatQuantity } from '@ezd/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DownloadIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { api, ApiError, type Quote } from '@/api/client';
import { quoteKey } from '@/api/keys';
import { FormError } from '@/components/form-error';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { DataList, type DataListColumn } from '@/components/patterns/data-list';
import { PageHeader } from '@/components/patterns/page-header';
import { LoadingState } from '@/components/patterns/state-views';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { formatPercent, quoteDate, sizeText } from '@/quotes/format';
import { useDownloadQuote } from '@/quotes/useDownloadQuote';
import { errorMessage } from './format';

type Line = Quote['lines'][number];

const COLUMNS: DataListColumn<Line>[] = [
  { id: 'description', header: 'Description', primary: true, cell: (line) => line.description },
  {
    id: 'qty',
    header: 'Qty',
    cell: (line) => (
      <span className="tabular-nums">
        {formatQuantity(line)}
        {line.unit === 'sqft' && ' sq ft'}
      </span>
    ),
  },
  { id: 'size', header: 'W x H x D', cell: (line) => sizeText(line) },
  { id: 'finish', header: 'Finish', cell: (line) => line.finishName },
  {
    id: 'unit',
    header: 'Unit price',
    cell: (line) => <span className="tabular-nums">{formatMoney(line.unitPriceCents)}</span>,
  },
  {
    id: 'total',
    header: 'Total',
    cell: (line) => <span className="tabular-nums">{formatMoney(line.lineTotalCents)}</span>,
  },
];

const BACK = buttonVariants({ variant: 'link', className: 'px-0' });

/** One stored quote, as its PDF shows it. */
export function QuotePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const quote = useQuery({
    queryKey: quoteKey(id),
    queryFn: () => api.getQuote(id),
    staleTime: Infinity,
  });
  const download = useDownloadQuote();
  const remove = useMutation({
    mutationFn: () => api.deleteQuote(id),
    onSuccess: () => void navigate(quote.data ? `/designs/${quote.data.design}` : '/projects'),
  });

  if (quote.error) {
    const missing = quote.error instanceof ApiError && quote.error.status === 404;
    return (
      <div className="space-y-6">
        <PageHeader
          title={missing ? 'Quote not found' : 'The quote could not be opened'}
          description={
            missing ? 'This quote does not exist or was deleted.' : errorMessage(quote.error)
          }
          actions={
            <Link to="/projects" className={BACK}>
              Back to projects
            </Link>
          }
        />
      </div>
    );
  }
  if (!quote.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Quote" />
        <LoadingState label="Loading the quote" />
      </div>
    );
  }

  const q = quote.data;
  const { totals, settings } = q;
  const rows: [string, number][] = [
    ['Subtotal', totals.subtotalCents],
    [`Markup ${formatPercent(settings.markupBps)}%`, totals.markupCents],
    [`Discount ${formatPercent(settings.discountBps)}%`, -totals.discountCents],
    ['Taxable', totals.taxableCents],
    [`Tax ${formatPercent(settings.taxBps)}%`, totals.taxCents],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Quote ${q.number}`}
        description={`${q.project_name} · ${q.design_name} · version ${q.design_version} · ${quoteDate(q.created_at)}`}
        actions={
          <>
            <Badge variant="success">Final</Badge>
            <Link to={`/designs/${q.design}`} className={buttonVariants({ variant: 'outline' })}>
              Back to the design
            </Link>
            <Button disabled={download.isPending} onClick={() => download.mutate(q.id)}>
              {download.isPending ? (
                <Spinner aria-hidden="true" />
              ) : (
                <DownloadIcon aria-hidden="true" />
              )}
              {download.isPending ? 'Making the PDF…' : 'Download PDF'}
            </Button>
            <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />
      <FormError error={download.error ?? remove.error} />

      <section aria-label="Customer">
        <Card>
          <CardContent className="text-sm">
            <p className="font-semibold">{q.customer_name}</p>
            {q.customer_email && <p>{q.customer_email}</p>}
            {q.customer_address && <p className="whitespace-pre-line">{q.customer_address}</p>}
          </CardContent>
        </Card>
      </section>

      <DataList
        caption="Quote lines"
        rows={q.lines}
        columns={COLUMNS}
        getRowId={(line) => line.key}
      />

      <Card className="ml-auto w-full md:w-80">
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            {rows.map(([name, cents]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="text-right tabular-nums">{formatMoney(cents)}</dd>
              </div>
            ))}
            <dt className="border-t border-foreground pt-1 font-semibold">Total</dt>
            <dd
              className="border-t border-foreground pt-1 text-right font-semibold tabular-nums"
              data-testid="quote-total"
            >
              {formatMoney(totals.totalCents)}
            </dd>
          </dl>
        </CardContent>
      </Card>

      {q.notes && (
        <section aria-label="Notes" className="text-sm">
          <h2 className="mb-1 font-semibold">Notes</h2>
          <p className="whitespace-pre-line">{q.notes}</p>
        </section>
      )}

      <section aria-label="Drawings" className="flex flex-col gap-4">
        <figure>
          <img
            src={q.drawings.plan}
            alt="Plan of the room"
            className="w-full rounded-lg bg-card ring-1 ring-foreground/10"
          />
          <figcaption className="mt-1 text-xs text-muted-foreground">Plan</figcaption>
        </figure>
        {q.drawings.elevations.map((elevation) => (
          <figure key={elevation.wallId}>
            <img
              src={elevation.image}
              alt={`Elevation of wall ${elevation.label}`}
              className="w-full rounded-lg bg-card ring-1 ring-foreground/10"
            />
            <figcaption className="mt-1 text-xs text-muted-foreground">
              Elevation of wall {elevation.label}
            </figcaption>
          </figure>
        ))}
      </section>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this quote?"
        description={`Quote ${q.number} and its PDF will be removed. This cannot be undone.`}
        confirmLabel="Delete quote"
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

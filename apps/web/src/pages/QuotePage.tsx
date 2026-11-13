import { formatMoney, formatQuantity } from '@ezd/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';

import { api, ApiError } from '../api/client';
import { quoteKey } from '../api/keys';
import { BUTTON } from '../editor/panels/fields';
import { formatPercent, quoteDate, sizeText } from '../quotes/format';
import { useDownloadQuote } from '../quotes/useDownloadQuote';
import { errorMessage } from './format';
import { FormError, LINK, Page } from './ui';

const CELL = 'px-2 py-1.5 text-left align-top';
const NUMBER = 'px-2 py-1.5 text-right align-top tabular-nums';

/** One stored quote, as its PDF shows it. */
export function QuotePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
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
      <Page title={missing ? 'Quote not found' : 'The quote could not be opened'}>
        <p className="text-sm text-slate-600">
          {missing ? 'This quote does not exist or was deleted.' : errorMessage(quote.error)}{' '}
          <Link to="/projects" className={LINK}>
            Back to projects
          </Link>
        </p>
      </Page>
    );
  }
  if (!quote.data) {
    return (
      <Page title="Quote">
        <p role="status" className="text-sm text-slate-600">
          Loading…
        </p>
      </Page>
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
    <Page title={`Quote ${q.number}`}>
      <div className="-mt-2 mb-6 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-600">
          {q.project_name} · {q.design_name} · version {q.design_version} ·{' '}
          {quoteDate(q.created_at)}
        </span>
        <Link to={`/designs/${q.design}`} className={`${LINK} mr-auto`}>
          Back to the design
        </Link>
        <button
          type="button"
          className={BUTTON}
          disabled={download.isPending}
          onClick={() => download.mutate(q.id)}
        >
          {download.isPending ? 'Making the PDF…' : 'Download PDF'}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete
        </button>
      </div>
      <FormError error={download.error ?? remove.error} />

      <section aria-label="Customer" className="mb-6 rounded-lg bg-white p-4 text-sm shadow-sm">
        <p className="font-semibold">{q.customer_name}</p>
        {q.customer_email && <p>{q.customer_email}</p>}
        {q.customer_address && <p className="whitespace-pre-line">{q.customer_address}</p>}
      </section>

      <div className="mb-6 overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-600">
            <tr>
              <th scope="col" className={NUMBER}>
                Qty
              </th>
              <th scope="col" className={CELL}>
                Description
              </th>
              <th scope="col" className={CELL}>
                W x H x D
              </th>
              <th scope="col" className={CELL}>
                Finish
              </th>
              <th scope="col" className={NUMBER}>
                Unit price
              </th>
              <th scope="col" className={NUMBER}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((line) => (
              <tr key={line.key} className="border-t border-slate-100">
                <td className={NUMBER}>
                  {formatQuantity(line)}
                  {line.unit === 'sqft' && ' sq ft'}
                </td>
                <td className={CELL}>{line.description}</td>
                <td className={`${CELL} whitespace-nowrap`}>{sizeText(line)}</td>
                <td className={CELL}>{line.finishName}</td>
                <td className={NUMBER}>{formatMoney(line.unitPriceCents)}</td>
                <td className={NUMBER}>{formatMoney(line.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mb-6 ml-auto grid w-72 grid-cols-2 gap-y-1 text-sm">
        {rows.map(([name, cents]) => (
          <div key={name} className="contents">
            <dt className="text-slate-600">{name}</dt>
            <dd className="text-right tabular-nums">{formatMoney(cents)}</dd>
          </div>
        ))}
        <dt className="border-t border-slate-900 pt-1 font-semibold">Total</dt>
        <dd
          className="border-t border-slate-900 pt-1 text-right font-semibold tabular-nums"
          data-testid="quote-total"
        >
          {formatMoney(totals.totalCents)}
        </dd>
      </dl>

      {q.notes && (
        <section aria-label="Notes" className="mb-6 text-sm">
          <h2 className="mb-1 font-semibold">Notes</h2>
          <p className="whitespace-pre-line">{q.notes}</p>
        </section>
      )}

      <section aria-label="Drawings" className="flex flex-col gap-4">
        <figure>
          <img
            src={q.drawings.plan}
            alt="Plan of the room"
            className="w-full rounded bg-white shadow-sm"
          />
          <figcaption className="mt-1 text-xs text-slate-600">Plan</figcaption>
        </figure>
        {q.drawings.elevations.map((elevation) => (
          <figure key={elevation.wallId}>
            <img
              src={elevation.image}
              alt={`Elevation of wall ${elevation.label}`}
              className="w-full rounded bg-white shadow-sm"
            />
            <figcaption className="mt-1 text-xs text-slate-600">
              Elevation of wall {elevation.label}
            </figcaption>
          </figure>
        ))}
      </section>
    </Page>
  );
}

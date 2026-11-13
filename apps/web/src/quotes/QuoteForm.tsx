import {
  computeBom,
  computeQuote,
  finishName,
  formatMoney,
  quoteSettingsProblem,
  type QuoteSettings,
} from '@ezd/core';
import { type FormEvent, useId, useMemo, useState } from 'react';

import type { QuoteCreate } from '../api/client';
import { BUTTON } from '../editor/panels/fields';
import { useDesign } from '../store/context';
import { parsePercent } from './format';

const INPUT =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500';

type Fields = {
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  markup: string;
  discount: string;
  tax: string;
  notes: string;
};

const EMPTY: Fields = {
  customerName: '',
  customerEmail: '',
  customerAddress: '',
  markup: '0',
  discount: '0',
  tax: '0',
  notes: '',
};

function Field({
  label,
  value,
  onChange,
  type = 'text',
  multiline = false,
  error,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: 'text' | 'email';
  multiline?: boolean;
  error?: string | null;
}) {
  const id = useId();
  const props = {
    id,
    className: INPUT,
    value,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${id}-error` : undefined,
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      {multiline ? (
        <textarea {...props} rows={2} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...props} type={type} onChange={(event) => onChange(event.target.value)} />
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** What the form hands on: the quote without the revision, which the caller knows. */
export type QuoteDraft = Omit<QuoteCreate, 'draft_revision' | 'drawings'>;

/**
 * The details of a new quote, with the total as it would be, for the design on screen.
 * Refuses to go on while the design has errors, unless the user says to.
 */
export function QuoteForm({
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  error: string | null;
  onSubmit(draft: QuoteDraft): void;
  onCancel(): void;
}) {
  const doc = useDesign((state) => state.doc);
  const catalog = useDesign((state) => state.catalog);
  const violations = useDesign((state) => state.violations);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [override, setOverride] = useState(false);
  const set = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const lines = useMemo(() => computeBom(doc, catalog), [doc, catalog]);
  const rates = {
    markupBps: parsePercent(fields.markup),
    discountBps: parsePercent(fields.discount),
    taxBps: parsePercent(fields.tax),
  };
  const settings: QuoteSettings | null =
    rates.markupBps !== null && rates.discountBps !== null && rates.taxBps !== null
      ? {
          markupBps: rates.markupBps,
          discountBps: rates.discountBps,
          taxBps: rates.taxBps,
          currency: 'USD',
        }
      : null;
  const settingsProblem = settings ? quoteSettingsProblem(settings) : null;
  const totals = settings && !settingsProblem ? computeQuote(lines, settings) : null;
  const errors = violations.filter((violation) => violation.severity === 'error').length;
  const blocked = errors > 0 && !override;
  const rateError = (value: number | null) =>
    value === null ? 'A percentage, such as 8.25.' : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!settings || !totals || blocked || !fields.customerName.trim()) return;
    onSubmit({
      customer_name: fields.customerName.trim(),
      customer_email: fields.customerEmail.trim(),
      customer_address: fields.customerAddress.trim(),
      notes: fields.notes.trim(),
      catalog_version: catalog.version,
      settings,
      lines: lines.map((line) => ({ ...line, finishName: finishName(catalog, line.finishId) })),
      totals,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer name" value={fields.customerName} onChange={set('customerName')} />
        <Field
          label="Customer email (optional)"
          type="email"
          value={fields.customerEmail}
          onChange={set('customerEmail')}
        />
      </div>
      <Field
        label="Customer address (optional)"
        multiline
        value={fields.customerAddress}
        onChange={set('customerAddress')}
      />
      <div className="grid grid-cols-3 gap-3">
        <Field
          label="Markup %"
          value={fields.markup}
          onChange={set('markup')}
          error={rateError(rates.markupBps)}
        />
        <Field
          label="Discount %"
          value={fields.discount}
          onChange={set('discount')}
          error={rateError(rates.discountBps)}
        />
        <Field
          label="Tax %"
          value={fields.tax}
          onChange={set('tax')}
          error={rateError(rates.taxBps)}
        />
      </div>
      {settingsProblem && (
        <p role="alert" className="text-sm text-red-700">
          {settingsProblem}
        </p>
      )}
      <Field label="Notes (optional)" multiline value={fields.notes} onChange={set('notes')} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded bg-slate-50 px-3 py-2 text-sm">
        <dt className="text-slate-600">Lines</dt>
        <dd className="text-right tabular-nums">{lines.length}</dd>
        {totals && (
          <>
            <dt className="text-slate-600">Subtotal</dt>
            <dd className="text-right tabular-nums">{formatMoney(totals.subtotalCents)}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold tabular-nums" data-testid="quote-form-total">
              {formatMoney(totals.totalCents)}
            </dd>
          </>
        )}
      </dl>

      {errors > 0 && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>
            The design has {errors === 1 ? '1 error' : `${errors} errors`}. Fix{' '}
            {errors === 1 ? 'it' : 'them'} in the Validation panel before quoting, or quote it as it
            is.
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-red-700"
              checked={override}
              onChange={(event) => setOverride(event.target.checked)}
            />
            Create the quote anyway
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={`${BUTTON} border-sky-700 bg-sky-700 text-white hover:bg-sky-800`}
          disabled={pending || blocked || !totals || !fields.customerName.trim()}
        >
          {pending ? 'Creating…' : 'Create quote'}
        </button>
      </div>
    </form>
  );
}

import {
  computeBom,
  computeQuote,
  finishName,
  formatMoney,
  quoteSettingsProblem,
  type QuoteDefaults,
  type QuoteSettings,
} from '@ezd/core';
import { type FormEvent, useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { QuoteCreate } from '../api/client';
import { useQuoteDefaults } from '../config/useConfig';
import { Field as LabelledField } from '../editor/panels/fields';
import { useDesign } from '../store/context';
import { formatPercent, parsePercent } from './format';

type Fields = {
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  markup: string;
  discount: string;
  tax: string;
  notes: string;
};

/** A new quote: nobody named yet, and the rates the Control Panel configured. */
const initialFields = (defaults: QuoteDefaults): Fields => ({
  customerName: '',
  customerEmail: '',
  customerAddress: '',
  markup: formatPercent(defaults.markupBps),
  discount: formatPercent(defaults.discountBps),
  tax: formatPercent(defaults.taxBps),
  notes: '',
});

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
    value,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${id}-error` : undefined,
  };
  return (
    <LabelledField label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      {multiline ? (
        <Textarea
          {...props}
          rows={2}
          className="min-h-16"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input {...props} type={type} onChange={(event) => onChange(event.target.value)} />
      )}
    </LabelledField>
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
  const defaults = useQuoteDefaults();
  const [fields, setFields] = useState<Fields>(() => initialFields(defaults));
  const [override, setOverride] = useState(false);
  const overrideId = useId();
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        <p role="alert" className="text-sm text-destructive">
          {settingsProblem}
        </p>
      )}
      <Field label="Notes (optional)" multiline value={fields.notes} onChange={set('notes')} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-lg bg-muted px-3 py-2 text-sm">
        <dt className="text-muted-foreground">Lines</dt>
        <dd className="text-right tabular-nums">{lines.length}</dd>
        {totals && (
          <>
            <dt className="text-muted-foreground">Subtotal</dt>
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
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
        >
          <p>
            The design has {errors === 1 ? '1 error' : `${errors} errors`}. Fix{' '}
            {errors === 1 ? 'it' : 'them'} in the Validation panel before quoting, or quote it as it
            is.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Checkbox
              id={overrideId}
              checked={override}
              aria-labelledby={`${overrideId}-label`}
              onCheckedChange={(next) => setOverride(next)}
            />
            <Label
              id={`${overrideId}-label`}
              className="font-normal"
              onClick={() => setOverride(!override)}
            >
              Create the quote anyway
            </Label>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || blocked || !totals || !fields.customerName.trim()}
        >
          {pending ? 'Creating…' : 'Create quote'}
        </Button>
      </div>
    </form>
  );
}

import {
  DEFAULT_QUOTE_DEFAULTS,
  parseQuoteDefaults,
  type QuoteBranding,
  type QuoteDefaults,
  MAX_DISCOUNT_BPS,
  MAX_RATE_BPS,
  quoteNumberLabel,
  settingsFromDefaults,
  validateQuoteDefaults,
} from '@ezd/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';

import { api } from '../api/client';
import { configDraftKey } from '../api/keys';
import { RequirePermission } from '../auth/permissions';
import { BUTTON } from '../editor/panels/fields';
import { errorMessage } from '../pages/format';
import { formatPercent, parsePercent } from '../quotes/format';
import { renderQuotePdf } from '../quotes/pdf';
import { NoAccess } from './AdminLayout';
import { FIELD } from './controls';
import { DraftSection, type LoadedSection } from './DraftSection';
import { fileToLogo, samplePlanImage } from './logo';
import { sampleQuote } from './sampleQuote';

/** What is on screen: the rates as typed, so a half-typed number is not lost. */
type Form = {
  markup: string;
  discount: string;
  tax: string;
  branding: QuoteBranding;
};

const toForm = (defaults: QuoteDefaults): Form => ({
  markup: formatPercent(defaults.markupBps),
  discount: formatPercent(defaults.discountBps),
  tax: formatPercent(defaults.taxBps),
  branding: defaults.branding,
});

/** The defaults a form says, or null while a rate is not a percentage. */
function toDefaults(form: Form): QuoteDefaults | null {
  const markupBps = parsePercent(form.markup);
  const discountBps = parsePercent(form.discount);
  const taxBps = parsePercent(form.tax);
  if (markupBps === null || discountBps === null || taxBps === null) return null;
  return { markupBps, discountBps, taxBps, currency: 'USD', branding: form.branding };
}

/** Each problem with a form, by the path core uses (`markupBps`, `branding.logo`). */
function problemsOf(form: Form): Map<string, string> {
  const problems = new Map<string, string>();
  const rates: [string, string, string, number][] = [
    ['markup', 'markupBps', 'Markup', MAX_RATE_BPS],
    ['discount', 'discountBps', 'Discount', MAX_DISCOUNT_BPS],
    ['tax', 'taxBps', 'Tax', MAX_RATE_BPS],
  ];
  for (const [field, path, name, max] of rates) {
    const bps = parsePercent(form[field as 'markup' | 'discount' | 'tax']);
    if (bps === null) problems.set(path, 'A percentage, such as 8.25.');
    else if (bps > max) {
      problems.set(path, `${name} must be between 0 and ${max / 100} percent, in steps of 0.01.`);
    }
  }
  const defaults = toDefaults(form);
  if (defaults && problems.size === 0) {
    const checked = validateQuoteDefaults(defaults);
    if (!checked.ok) {
      for (const issue of checked.error) problems.set(issue.path, issue.message);
    }
  }
  return problems;
}

function TextField({
  label,
  value,
  onChange,
  error,
  multiline = false,
  hint,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string | undefined;
  multiline?: boolean;
  hint?: string;
}) {
  const id = useId();
  const props = {
    id,
    className: `${FIELD} w-full`,
    value,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${id}-error` : undefined,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function LogoField({
  logo,
  onChange,
  error,
}: {
  logo: string;
  onChange(logo: string): void;
  error?: string | undefined;
}) {
  const id = useId();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        Logo
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {logo !== '' && (
          <img
            src={logo}
            alt="Current logo"
            className="max-h-16 max-w-48 rounded border border-slate-200 bg-white"
          />
        )}
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg"
          className="text-sm"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setFailure(null);
            setBusy(true);
            fileToLogo(file).then(
              (url) => {
                setBusy(false);
                onChange(url);
              },
              (cause: unknown) => {
                setBusy(false);
                setFailure(cause instanceof Error ? cause.message : 'The logo could not be read.');
              },
            );
          }}
        />
        {logo !== '' && (
          <button type="button" className={BUTTON} onClick={() => onChange('')}>
            Remove logo
          </button>
        )}
      </div>
      <p className="text-xs text-slate-600">
        A PNG or JPEG. It is scaled to fit and saved as a plain PNG, under 150 KB.
      </p>
      {(failure ?? error) && (
        <p role="alert" className="text-xs text-red-700">
          {failure ?? error}
        </p>
      )}
    </div>
  );
}

/** The PDF of a made-up quote with the branding being edited, drawn by the real PDF code. */
function PdfPreview({ defaults }: { defaults: QuoteDefaults }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const render = async () => {
    setState('busy');
    try {
      const plan = await samplePlanImage();
      const blob = await renderQuotePdf(
        sampleQuote(defaults.branding, settingsFromDefaults(defaults), plan),
      );
      setUrl(URL.createObjectURL(blob));
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  return (
    <section aria-label="PDF preview" className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">PDF preview</h2>
        <button type="button" className={BUTTON} disabled={state === 'busy'} onClick={render}>
          {state === 'busy' ? 'Drawing…' : url ? 'Refresh preview' : 'Preview PDF'}
        </button>
      </div>
      {state === 'failed' && (
        <p role="alert" className="text-sm text-red-700">
          The preview could not be drawn.
        </p>
      )}
      {url && (
        <iframe title="Quote PDF preview" src={url} className="h-[36rem] w-full rounded border" />
      )}
      {!url && state !== 'failed' && (
        <p className="text-sm text-slate-600">
          Draws a sample quote with this branding, as a customer would get it.
        </p>
      )}
    </section>
  );
}

function QuotesForm({ form, onChange }: { form: Form; onChange(next: Form): void }) {
  const problems = useMemo(() => problemsOf(form), [form]);
  const defaults = toDefaults(form);
  const branding = (patch: Partial<QuoteBranding>) =>
    onChange({ ...form, branding: { ...form.branding, ...patch } });
  const b = form.branding;
  return (
    <>
      <section aria-label="Default rates" className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Default rates</h2>
        <p className="mb-3 text-sm text-slate-600">
          What a new quote starts with. Whoever makes the quote can still change them. Currency is
          US dollars.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField
            label="Markup %"
            value={form.markup}
            error={problems.get('markupBps')}
            onChange={(markup) => onChange({ ...form, markup })}
          />
          <TextField
            label="Discount %"
            value={form.discount}
            error={problems.get('discountBps')}
            onChange={(discount) => onChange({ ...form, discount })}
          />
          <TextField
            label="Tax %"
            value={form.tax}
            error={problems.get('taxBps')}
            onChange={(tax) => onChange({ ...form, tax })}
          />
        </div>
      </section>
      <section aria-label="Company branding" className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Company branding</h2>
        <p className="mb-3 text-sm text-slate-600">
          Printed at the top of each quote&rsquo;s PDF. A quote keeps what was published when it was
          made, so changing this never changes a quote that exists.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Company name"
            value={b.companyName}
            error={problems.get('branding.companyName')}
            onChange={(companyName) => branding({ companyName })}
          />
          <TextField
            label="Quote number prefix"
            value={b.numberPrefix}
            error={problems.get('branding.numberPrefix')}
            hint={`Quote 3 is shown as ${quoteNumberLabel(b.numberPrefix, 3)}.`}
            onChange={(numberPrefix) => branding({ numberPrefix })}
          />
          <TextField
            label="Address"
            multiline
            value={b.address}
            error={problems.get('branding.address')}
            onChange={(address) => branding({ address })}
          />
          <TextField
            label="Contact (phone, email, web)"
            multiline
            value={b.contact}
            error={problems.get('branding.contact')}
            onChange={(contact) => branding({ contact })}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Footer text"
              multiline
              value={b.footerText}
              error={problems.get('branding.footerText')}
              hint="Printed at the bottom of every page, such as how long the prices are good for."
              onChange={(footerText) => branding({ footerText })}
            />
          </div>
          <div className="sm:col-span-2">
            <LogoField
              logo={b.logo}
              error={problems.get('branding.logo')}
              onChange={(logo) => branding({ logo })}
            />
          </div>
        </div>
      </section>
      {defaults && problems.size === 0 && <PdfPreview defaults={defaults} />}
    </>
  );
}

/**
 * The quote defaults: the rates a new quote starts with and the company branding on its
 * PDF, edited as a draft and published with the other settings.
 */
export function QuotesAdminPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const draft = useQuery({ queryKey: configDraftKey, queryFn: api.getConfigDraft });
  const loaded = useMemo<LoadedSection<Form> | null>(() => {
    if (!draft.data) return null;
    const parsed = parseQuoteDefaults(draft.data.quote_defaults ?? {});
    return {
      revision: draft.data.revision,
      basedOn: draft.data.based_on,
      value: toForm(parsed.ok ? parsed.value.config : DEFAULT_QUOTE_DEFAULTS),
    };
  }, [draft.data]);
  return (
    <RequirePermission permission="config.quote.edit" fallback={<NoAccess />}>
      <h1 className="mb-4 text-xl font-semibold">Quotes</h1>
      {loaded ? (
        <DraftSection<Form>
          key={`${loaded.revision}-${loaded.basedOn}`}
          loaded={loaded}
          save={(revision, form) => {
            const defaults = toDefaults(form);
            if (!defaults) return Promise.reject(new Error('The rates are not valid.'));
            return api.saveQuoteDefaultsDraft(revision, defaults);
          }}
          problems={(form) => problemsOf(form).size}
          notice={notice}
          onPublished={setNotice}
          onReset={() => toForm(DEFAULT_QUOTE_DEFAULTS)}
        >
          {({ value, set }) => <QuotesForm form={value} onChange={set} />}
        </DraftSection>
      ) : draft.error ? (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage(draft.error)}
        </p>
      ) : (
        <p role="status" className="text-sm text-slate-600">
          Loading…
        </p>
      )}
    </RequirePermission>
  );
}

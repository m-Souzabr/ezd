import { formatLength, type Len, parseLength } from '@ezd/core';
import { Label } from 'radix-ui';
import { type ReactNode, useId, useState } from 'react';

// Form controls for the panels. Every one is a native control with a visible label, so it
// is reachable and operable from the keyboard.

const control =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500 ' +
  'disabled:bg-slate-100 disabled:text-slate-500';

export function Field({
  label,
  htmlFor,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={htmlFor} className="text-xs font-medium text-slate-600">
        {label}
      </Label.Root>
      {children}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A length typed in inches. The text goes through `parseLength` when the user presses
 * Enter or leaves the field; `onCommit` then gets the length and returns an error to show,
 * such as the reason core refused it, or null. `choices` are offered as a dropdown.
 */
export function LengthField({
  label,
  value,
  onCommit,
  choices,
  disabled = false,
}: {
  label: string;
  value: Len;
  onCommit(length: Len): string | null;
  choices?: readonly Len[];
  disabled?: boolean;
}) {
  const id = useId();
  // Null while the field shows the document's value; a string while the user is typing.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDraft(null);
    setError(null);
  };
  const commit = (text: string | null) => {
    if (text === null) return;
    const parsed = parseLength(text);
    if (!parsed.ok) {
      setError(parsed.error.message);
      return;
    }
    const refused = parsed.value === value ? null : onCommit(parsed.value);
    if (refused) setError(refused);
    else reset();
  };

  return (
    <Field label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={control}
        value={draft ?? formatLength(value)}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        list={choices ? `${id}-choices` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(draft ?? formatLength(value));
          if (event.key === 'Escape') {
            reset();
            event.stopPropagation();
          }
        }}
      />
      {choices && (
        <datalist id={`${id}-choices`}>
          {choices.map((choice) => (
            <option key={choice} value={formatLength(choice)} />
          ))}
        </datalist>
      )}
    </Field>
  );
}

/** A dropdown of fixed choices. `value` and the option values are strings. */
export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        className={control}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-4 rounded border-slate-300 accent-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <Label.Root htmlFor={id} className="text-sm text-slate-700">
        {label}
      </Label.Root>
    </div>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-h-0 flex-col">
      <h2 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export const BUTTON =
  'inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 ' +
  'text-sm text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500 ' +
  'data-[state=on]:border-sky-700 data-[state=on]:bg-sky-700 data-[state=on]:text-white';

import type { Len } from '@ezd/core';
import { useId, useState } from 'react';

import { Field } from '@/editor/panels/fields';
import { Input } from '@/components/ui/input';
import { formatDollars, formatLengthList, parseDollars, parseLengthList } from './helpers';

/** A text field that commits on Enter or blur. `onCommit` returns an error or null. */
export function CommitField({
  label,
  value,
  onCommit,
  inputMode,
  disabled = false,
}: {
  label: string;
  value: string;
  onCommit(text: string): string | null;
  inputMode?: 'text' | 'decimal';
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const refused = draft === value ? null : onCommit(draft);
    setError(refused);
    if (!refused) setDraft(null);
  };
  return (
    <Field label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      <Input
        id={id}
        type="text"
        autoComplete="off"
        inputMode={inputMode}
        value={draft ?? value}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(null);
            setError(null);
          }
        }}
      />
    </Field>
  );
}

/** Dollars in, integer cents out. */
export function MoneyField({
  label,
  cents,
  onCommit,
}: {
  label: string;
  cents: number;
  onCommit(cents: number): void;
}) {
  return (
    <CommitField
      label={label}
      value={formatDollars(cents)}
      inputMode="decimal"
      onCommit={(text) => {
        const parsed = parseDollars(text);
        if (parsed === null) return 'Use an amount in dollars, such as 125.50.';
        onCommit(parsed);
        return null;
      }}
    />
  );
}

/** Several lengths in one field, separated by commas: `34 1/2, 36`. */
export function LengthListField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: readonly Len[];
  onCommit(lengths: Len[]): void;
}) {
  return (
    <CommitField
      label={label}
      value={formatLengthList(value)}
      onCommit={(text) => {
        const parsed = parseLengthList(text);
        if (!parsed.ok) return parsed.message;
        onCommit(parsed.value);
        return null;
      }}
    />
  );
}

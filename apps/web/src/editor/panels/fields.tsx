import { formatLength, type Len, parseLength } from '@ezd/core';
import { type ReactNode, useId, useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Field as DsField, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';

// Form controls for the panels, on the design system's `Field`, `Input`, `NativeSelect` and
// `Checkbox`. Every one has a visible label, so it is reachable and operable from the keyboard.
// The select is the platform's own: a phone shows its picker.

/** A label, a control and the reason it was refused. */
export function Field({
  label,
  htmlFor,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | null | undefined;
  errorId?: string | undefined;
  children: ReactNode;
}) {
  return (
    <DsField data-invalid={error ? true : undefined} className="gap-1.5">
      <FieldLabel htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </FieldLabel>
      {children}
      {error && (
        <FieldError id={errorId} className="text-xs">
          {error}
        </FieldError>
      )}
    </DsField>
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
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
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
            // Escape undoes what was typed and goes no further. In a sheet, with nothing typed,
            // it goes on to close the sheet.
            const dirty = draft !== null || error !== null;
            reset();
            if (dirty || !event.currentTarget.closest('[role="dialog"]')) event.stopPropagation();
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
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
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
  const labelId = `${id}-label`;
  // The label names the checkbox by id, not by wrapping it: Base UI's checkbox is a button
  // with a hidden input, and a wrapping `<label>` would name both. Clicking the text toggles.
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        aria-labelledby={labelId}
        onCheckedChange={(next) => onChange(next)}
      />
      <Label id={labelId} className="font-normal" onClick={() => onChange(!checked)}>
        {label}
      </Label>
    </div>
  );
}

/** A titled block of a side panel. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-h-0 flex-col">
      <h2 className="border-b bg-muted px-3 py-2 text-xs font-semibold tracking-wide text-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

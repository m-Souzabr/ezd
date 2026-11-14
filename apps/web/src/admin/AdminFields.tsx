import { useId } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** A labelled text input with the reasons the server refused it. */
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete = 'off',
  errors = [],
  required = true,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  autoComplete?: string;
  errors?: string[];
  required?: boolean;
}) {
  const id = useId();
  return (
    <Field data-invalid={errors.length > 0 || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        required={required}
        aria-invalid={errors.length > 0}
        onChange={(event) => onChange(event.target.value)}
      />
      {errors.map((message) => (
        <FieldError key={message}>{message}</FieldError>
      ))}
    </Field>
  );
}

/** A checkbox with its label, from the design system. */
export function CheckField({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

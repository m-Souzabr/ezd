import type { HTMLInputTypeAttribute, HTMLAttributes, ReactNode } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type FormSectionProps = {
  title: string;
  description?: string;
  /** `one` keeps a narrow form (sign in, a dialog) in a single column at every width. */
  columns?: 'one' | 'two';
  children: ReactNode;
};

export function FormSection({ title, description, columns = 'two', children }: FormSectionProps) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldGroup className={cn('grid gap-4', columns === 'two' && 'md:grid-cols-2')}>
        {children}
      </FieldGroup>
    </FieldSet>
  );
}

type TextFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  required?: boolean;
};

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  type = 'text',
  autoComplete = 'off',
  inputMode,
  required,
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Input
            {...field}
            id={field.name}
            type={type}
            autoComplete={autoComplete}
            inputMode={inputMode}
            required={required}
            aria-invalid={fieldState.invalid}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

type FormActionsProps = {
  children: ReactNode;
  /** The form is inside the app shell, so the bar sits above its bottom tab bar on a phone. */
  aboveTabBar?: boolean;
};

export function FormActions({ children, aboveTabBar = false }: FormActionsProps) {
  return (
    <div
      className={cn(
        'sticky z-30 -mx-4 flex gap-2 border-t bg-background px-4 pt-3 pb-safe-3 md:static md:mx-0 md:justify-end md:border-0 md:p-0',
        aboveTabBar ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]' : 'bottom-0',
      )}
    >
      {children}
    </div>
  );
}

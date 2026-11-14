import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormError } from '@/components/form-error';
import { FormSection, TextField } from '@/components/patterns/form-section';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { applyServerErrors } from '@/lib/formErrors';

const NameSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(200, 'Use at most 200 characters.'),
});
type NameValues = z.infer<typeof NameSchema>;

type NameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The field's label, and what its accessible name is. */
  label: string;
  submitLabel: string;
  initial?: string | undefined;
  placeholder?: string;
  /** Resolves when the name was accepted; the dialog then closes. A rejection stays open. */
  onSubmit: (name: string) => Promise<unknown>;
};

function NameForm({
  title,
  description,
  label,
  submitLabel,
  initial = '',
  onSubmit,
  onOpenChange,
  open,
}: NameDialogProps) {
  const formId = useId();
  const { control, handleSubmit, setError, formState } = useForm<NameValues>({
    resolver: zodResolver(NameSchema),
    defaultValues: { name: initial },
  });
  const [failure, setFailure] = useState<unknown>(null);

  const submit = handleSubmit(async ({ name }) => {
    setFailure(null);
    try {
      await onSubmit(name);
      onOpenChange(false);
    } catch (error) {
      applyServerErrors(setError, error, ['name']);
      setFailure(error);
    }
  });

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Spinner aria-hidden="true" /> : null}
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <FormSection title="Details" columns="one">
          <TextField control={control} name="name" label={label} required />
        </FormSection>
        <FormError error={failure} fields={['name']} />
      </form>
    </ResponsiveDialog>
  );
}

/**
 * A dialog (a drawer on a phone) with one name field, for creating or renaming a project or
 * a design. The form is mounted only while the dialog is open, so it starts clean each time.
 */
export function NameDialog(props: NameDialogProps) {
  return props.open ? <NameForm key={props.title} {...props} /> : null;
}

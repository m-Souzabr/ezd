import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { FormSection, TextField } from '@/components/patterns/form-section';

type Values = { name: string };

function Form({ withError }: { withError: boolean }) {
  const { control } = useForm<Values>({
    defaultValues: { name: '' },
    ...(withError ? { errors: { name: { type: 'required', message: 'Enter a name.' } } } : {}),
  });
  return (
    <FormSection title="Client" description="Who the quote is for.">
      <TextField
        control={control}
        name="name"
        label="Name"
        description="As on the contract."
        inputMode="text"
        required
      />
    </FormSection>
  );
}

describe('TextField', () => {
  it('shows its error and marks the input invalid', () => {
    render(<Form withError />);
    expect(screen.getByRole('group', { name: 'Client' })).toBeInTheDocument();
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows no error when the field is valid', () => {
    render(<Form withError={false} />);
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByText('As on the contract.')).toBeInTheDocument();
  });

  it('forwards inputMode and required, and takes typing', async () => {
    render(<Form withError={false} />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('inputmode', 'text');
    expect(input).toBeRequired();
    await userEvent.setup().type(input, 'Ana');
    expect(input).toHaveValue('Ana');
  });
});

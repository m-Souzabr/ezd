import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ChoiceGroup } from './controls';

const CHOICES = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', name: 'Second' },
  { value: 'c', label: 'Gamma' },
];

function Harness({ start = 'a' }: { start?: string }) {
  const [value, setValue] = useState(start);
  return <ChoiceGroup label="Letters" value={value} choices={CHOICES} onChange={setValue} />;
}

describe('ChoiceGroup', () => {
  it('is a radio group with the chosen button checked', () => {
    render(<Harness start="b" />);
    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Second' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Gamma' })).not.toBeChecked();
  });

  it('chooses on click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(screen.getByRole('radio', { name: 'Gamma' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toBeChecked();
  });

  it('checks nothing when the value is not one of the choices', () => {
    render(<Harness start="none" />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });
});

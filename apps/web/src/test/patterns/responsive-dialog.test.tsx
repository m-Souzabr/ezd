import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { mockMedia } from '@/test/media';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Rename"
        description="Pick a new name."
        footer={<button type="button">Save</button>}
      >
        <p>Body</p>
      </ResponsiveDialog>
    </>
  );
}

describe('ResponsiveDialog', () => {
  it('is a dialog when the screen is MD_UP', async () => {
    mockMedia(true);
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog', { name: 'Rename' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
    expect(screen.getByText('Pick a new name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('is a drawer when the screen is smaller', async () => {
    mockMedia(false);
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('Body')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
  });

  it.each([true, false])('returns focus to the trigger on Escape (MD_UP %s)', async (mdUp) => {
    mockMedia(mdUp);
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await screen.findByText('Body');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Body')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

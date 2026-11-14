import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this project?"
        description="This cannot be undone."
        confirmLabel="Delete project"
        onConfirm={onConfirm}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('confirms, closes and returns focus to the trigger', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Delete' });
    await user.click(trigger);
    expect(await screen.findByRole('alertdialog', { name: 'Delete this project?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('cancels without confirming and returns focus to the trigger', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Delete' });
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

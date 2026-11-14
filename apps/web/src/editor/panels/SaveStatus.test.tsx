import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Autosave, SaveStatus as Status } from '../../lib/autosave';
import { ConflictDialog, SaveStatus } from './SaveStatus';

/** An autosave whose status the test sets. */
function fake(initial: Status) {
  let status = initial;
  const listeners = new Set<() => void>();
  const autosave: Autosave = {
    status: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    hasUnsavedChanges: () => false,
    flush: vi.fn(async () => {}),
    overwrite: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  const set = (next: Status) => {
    status = next;
    act(() => listeners.forEach((listener) => listener()));
  };
  return { autosave, set };
}

describe('SaveStatus', () => {
  it.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['offline', 'Offline (retrying)'],
    ['conflict', 'Conflict'],
    ['error', 'Not saved'],
  ] as const)('says %s in words and with an icon', (status, text) => {
    const { autosave } = fake(status);
    render(<SaveStatus autosave={autosave} />);
    const shown = screen.getByTestId('save-status');
    expect(shown).toHaveTextContent(text);
    expect(shown.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('offers a retry when offline or not saved', () => {
    const { autosave, set } = fake('saved');
    render(<SaveStatus autosave={autosave} />);
    expect(screen.queryByRole('button', { name: 'Retry now' })).not.toBeInTheDocument();
    set('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(autosave.flush).toHaveBeenCalledTimes(1);
  });
});

describe('ConflictDialog', () => {
  it('is a blocking choice between the two documents', async () => {
    const { autosave, set } = fake('saved');
    const reload = vi.fn();
    render(<ConflictDialog autosave={autosave} onReloadTheirs={reload} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    set('conflict');
    const dialog = await screen.findByRole('alertdialog', {
      name: 'This design was changed elsewhere',
    });
    // Escape does not dismiss it: only one of the two buttons ends the conflict.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reload theirs' }));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite with mine' }));
    expect(autosave.overwrite).toHaveBeenCalledTimes(1);
  });
});

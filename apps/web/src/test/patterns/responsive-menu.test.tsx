import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ResponsiveMenu } from '@/components/patterns/responsive-menu';
import { mockMedia } from '@/test/media';

function setup() {
  const onSelect = vi.fn();
  render(
    <ResponsiveMenu
      label="Project actions"
      actions={[
        { id: 'rename', label: 'Rename', onSelect },
        { id: 'delete', label: 'Delete', destructive: true, onSelect: vi.fn() },
      ]}
    />,
  );
  return { onSelect, trigger: screen.getByRole('button', { name: 'Project actions' }) };
}

describe('ResponsiveMenu', () => {
  it('is a dropdown menu when the screen is MD_UP, and calls onSelect', async () => {
    mockMedia(true);
    const user = userEvent.setup();
    const { onSelect, trigger } = setup();
    await user.click(trigger);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('is a drawer of buttons when the screen is smaller, and calls onSelect', async () => {
    mockMedia(false);
    const user = userEvent.setup();
    const { onSelect, trigger } = setup();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it('returns focus to the trigger when the menu is dismissed', async () => {
    mockMedia(true);
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

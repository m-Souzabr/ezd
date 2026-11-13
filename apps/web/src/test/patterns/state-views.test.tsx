import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/state-views';

describe('state views', () => {
  it('announces loading by its label', () => {
    render(<LoadingState label="Loading projects" />);
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument();
  });

  it('explains an empty list and offers its action', () => {
    render(
      <EmptyState title="No projects" description="Create one." action={<button>Create</button>} />,
    );
    expect(screen.getByText('No projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('is an alert that retries', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Failed" description="Try later." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

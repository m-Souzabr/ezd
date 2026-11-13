import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';
import { registerRecoverySource } from './lib/recovery';
import { setErrorReporter } from './lib/reportError';
import * as repository from './lib/repository';
import { room } from './test/kitchen';

function Boom(): never {
  throw new Error('kaboom');
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('reports the crash and offers the open design for download', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reported = vi.fn();
    const restore = setErrorReporter(reported);
    const download = vi.spyOn(repository, 'downloadDocument').mockImplementation(() => {});
    const doc = { ...room(144, 120), name: 'Saved kitchen' };
    registerRecoverySource(() => doc);

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download my design (JSON)' }));
    expect(download).toHaveBeenCalledWith(doc);
    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'kaboom' }),
      expect.objectContaining({ where: 'react' }),
    );
    restore();
  });

  it('does not offer a download when no design can be read', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerRecoverySource(() => {
      throw new Error('gone');
    });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
  });
});

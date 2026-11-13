import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { room, seedItem, storeFor, WALLS } from '../../test/kitchen';
import { renderWithStore } from '../../test/render';
import { BomPanel } from './BomPanel';

const [A, B] = WALLS;

afterEach(() => vi.restoreAllMocks());

describe('BomPanel', () => {
  it('lists the lines with their size in inches, prices and the subtotal', () => {
    const store = storeFor(
      room(
        144,
        120,
        seedItem('item-000001', 'base.standard', A, 0),
        seedItem('item-000002', 'base.standard', A, 30),
        seedItem('item-000003', 'wall.standard', B, 0),
      ),
    );
    renderWithStore(<BomPanel />, store);

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      '2Base cabinet, 2 doors, top drawer, hinge left30" x 34 1/2" x 24"White$325.00$650.00',
      expect.stringMatching(/^1Wall cabinet.*\$/) as string,
    ]);
    const wallTotal = Number(rows[1]!.lastChild!.textContent!.replace(/[$,]/g, '')) * 100;
    expect(screen.getByTestId('bom-subtotal')).toHaveTextContent(
      `$${((65000 + wallTotal) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    );
  });

  it('follows the document as it changes', () => {
    const store = storeFor(room(144, 120, seedItem('item-000001', 'base.standard', A, 0)));
    renderWithStore(<BomPanel />, store);
    expect(screen.getByTestId('bom-subtotal')).toHaveTextContent('$325.00');

    act(() => {
      expect(store.getState().execute({ type: 'item.remove', id: 'item-000001' }).ok).toBe(true);
    });

    expect(screen.getByTestId('bom-subtotal')).toHaveTextContent('$0.00');
    expect(screen.getByText(/Nothing to count yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('selects the items of a line', () => {
    const store = storeFor(
      room(
        144,
        120,
        seedItem('item-000001', 'base.standard', A, 0),
        seedItem('item-000002', 'base.standard', A, 30),
      ),
    );
    renderWithStore(<BomPanel />, store);

    const line = screen.getByRole('button', { name: /^Base cabinet/ });
    expect(line).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(line);

    expect(store.getState().selection).toEqual(['item-000001', 'item-000002']);
    expect(line).toHaveAttribute('aria-pressed', 'true');
  });

  it('exports the lines as CSV', async () => {
    const store = storeFor(room(144, 120, seedItem('item-000001', 'base.standard', A, 0)));
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:csv';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithStore(<BomPanel />, store);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs[0]!.type).toBe('text/csv');
    const text = await blobs[0]!.text();
    expect(text.split('\r\n')[1]).toBe(
      '1,each,"Base cabinet, 2 doors, top drawer, hinge left","30""","34 1/2""","24""",White,$325.00,$325.00',
    );
  });
});

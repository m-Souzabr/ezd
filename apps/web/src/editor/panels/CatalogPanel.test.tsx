import { inches } from '@ezd/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { apply, room, seedItem, storeFor, WALLS } from '../../test/kitchen';
import { renderWithStore } from '../../test/render';
import { CatalogPanel } from './CatalogPanel';

const [A] = WALLS;
const rowOf = (catalogId: string) =>
  screen.getByTestId(`catalog-${catalogId}`).closest('li') as HTMLElement;

describe('CatalogPanel', () => {
  it('groups the entries by kind', () => {
    renderWithStore(<CatalogPanel />, storeFor(room()));
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual([
      'Base cabinets',
      'Wall cabinets',
      'Tall cabinets',
      'Corner cabinets',
      'Appliances',
      'Fillers',
      'Panels',
    ]);
    const base = screen.getByRole('region', { name: 'Base cabinets' });
    expect(within(base).getAllByRole('listitem')).toHaveLength(3);
  });

  it('filters with the search box', () => {
    renderWithStore(<CatalogPanel />, storeFor(room()));
    fireEvent.change(screen.getByLabelText('Search the catalog'), { target: { value: 'sink' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Sink base cabinet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search the catalog'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing in the catalog matches.')).toBeInTheDocument();
  });

  it('limits each width picker to the 3 in steps the entry allows', () => {
    renderWithStore(<CatalogPanel />, storeFor(room()));
    const widths = (catalogId: string) =>
      within(within(rowOf(catalogId)).getByLabelText('Width'))
        .getAllByRole('option')
        .map((option) => option.textContent);

    expect(widths('base.sink')).toEqual(['24"', '27"', '30"', '33"', '36"', '39"', '42"']);
    expect(widths('appliance.range')).toEqual(['30"', '36"']);
    expect(within(rowOf('base.standard')).getByLabelText('Width')).toHaveValue(String(inches(30)));
  });

  it('starts a drag of an item at the chosen width, which is not yet in the document', () => {
    const store = storeFor(room());
    renderWithStore(<CatalogPanel />, store);
    const row = rowOf('base.standard');
    fireEvent.change(within(row).getByLabelText('Width'), {
      target: { value: String(inches(18)) },
    });
    expect(within(row).getByText('B18')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId('catalog-base.standard'), { button: 0 });

    expect(store.getState().drag).toMatchObject({
      kind: 'add',
      snap: null,
      item: { catalogId: 'base.standard', width: inches(18), height: inches(34.5) },
    });
    expect(store.getState().doc.items).toEqual([]);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('adds an item from the keyboard at the first free stretch of wall', () => {
    const store = storeFor(room(144, 120, seedItem('item-000001', 'base.standard', A, 0)));
    renderWithStore(<CatalogPanel />, store);

    fireEvent.click(screen.getByRole('button', { name: 'Add Sink base cabinet' }));

    const { doc, selection, history } = store.getState();
    expect(history.past.map((entry) => entry.command.type)).toEqual(['item.add']);
    expect(doc.items[1]).toMatchObject({
      catalogId: 'base.sink',
      placement: { type: 'wall', wallId: A, offset: inches(30) },
    });
    expect(selection).toEqual([doc.items[1]!.id]);
  });

  it('says why a wall cabinet cannot be added to a room with no walls', () => {
    const store = storeFor(
      apply(room(), ...WALLS.map((id) => ({ type: 'wall.remove' as const, id }))),
    );
    renderWithStore(<CatalogPanel />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Add Wall cabinet' }));
    expect(store.getState().notice).toMatch(/Draw a wall first/);
    expect(store.getState().doc.items).toEqual([]);
  });

  it('takes a typed width for a filler, within its range', () => {
    const store = storeFor(room());
    renderWithStore(<CatalogPanel />, store);
    const row = rowOf('filler.base');
    const width = within(row).getByLabelText('Width');

    fireEvent.change(width, { target: { value: '8' } });
    expect(within(row).getByRole('alert')).toHaveTextContent('Use 1/2" to 6".');
    expect(within(row).getByRole('button', { name: 'Add Base filler' })).toBeDisabled();

    fireEvent.change(width, { target: { value: '1 3/8' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Add Base filler' }));
    expect(store.getState().doc.items[0]).toMatchObject({ kind: 'filler', width: 22 });
  });
});

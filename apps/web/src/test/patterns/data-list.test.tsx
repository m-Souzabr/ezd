import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataList, type DataListColumn, type DataListSort } from '@/components/patterns/data-list';

type Row = { id: string; name: string; total: number };

const ROWS: Row[] = [
  { id: 'a', name: 'Kitchen', total: 300 },
  { id: 'b', name: 'Bar', total: 100 },
];

const COLUMNS: DataListColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, primary: true, sortable: true },
  { id: 'total', header: 'Total', cell: (row) => `$${row.total}`, sortable: true },
];

describe('DataList', () => {
  it('renders every row as a card and as a table row', () => {
    render(
      <DataList
        caption="Projects"
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        rowActions={(row) => <button type="button">Open {row.name}</button>}
      />,
    );
    const cards = within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('Kitchen')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('Total')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Projects' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('cell', { name: 'Kitchen' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Open Bar' })).toBeInTheDocument();
  });

  it('asks for a sort from a header and flips it on the second click', async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataList
        caption="Projects"
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        sort={{ id: 'name', descending: false }}
        onSortChange={onSortChange}
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(within(table).getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'name', descending: true });
    await user.click(within(table).getByRole('button', { name: /Total/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'total', descending: false });
  });

  it('reorders when the caller sorts, and says so on the cards', async () => {
    function Harness() {
      const [sort, setSort] = useState<DataListSort>({ id: 'name', descending: false });
      const rows = [...ROWS].sort((a, b) => {
        const order = sort.id === 'total' ? a.total - b.total : a.name.localeCompare(b.name);
        return sort.descending ? -order : order;
      });
      return (
        <DataList
          caption="Projects"
          rows={rows}
          columns={COLUMNS}
          getRowId={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const names = () =>
      within(screen.getByRole('table'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
    expect(names()).toEqual(['Bar', 'Kitchen']);
    expect(screen.getByText('Sorted by Name, ascending')).toBeInTheDocument();

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /Total/ }));
    expect(names()).toEqual(['Bar', 'Kitchen']);
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /Total/ }));
    expect(names()).toEqual(['Kitchen', 'Bar']);
    expect(screen.getByText('Sorted by Total, descending')).toBeInTheDocument();
  });

  it('shows no sort text and no sort buttons without a sort', () => {
    render(
      <DataList caption="Projects" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />,
    );
    expect(screen.queryByText(/Sorted by/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

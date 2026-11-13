import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { formatSort, parseSort } from './sort';
import { Table, type Column } from './Table';

type Row = { id: number; name: string };
const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, cell: (row) => row.name },
  { key: 'id', header: 'Id', cell: (row) => row.id },
];
const ROWS: Row[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Bob' },
];

describe('sort', () => {
  it('reads and writes the server form', () => {
    expect(parseSort('-email')).toEqual({ key: 'email', descending: true });
    expect(parseSort('email')).toEqual({ key: 'email', descending: false });
    expect(formatSort({ key: 'email', descending: true })).toBe('-email');
  });
});

describe('Table', () => {
  const table = (props: Partial<Parameters<typeof Table<Row>>[0]> = {}) =>
    render(
      <Table label="People" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} {...props} />,
    );

  it('shows a row per item', () => {
    table();
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('says it is loading, is empty, or has failed', () => {
    const { rerender } = table({ rows: undefined, loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    rerender(
      <Table
        label="People"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        empty="No people."
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No people.');
    rerender(
      <Table label="People" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} error="Boom" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('sorts by a header button, which flips an active column', () => {
    const onSort = vi.fn();
    table({ sort: { key: 'name', descending: false }, onSort });

    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'name', descending: true });
  });

  it('starts a column that is not sorted yet ascending, and has no button for the others', () => {
    const onSort = vi.fn();
    table({ sort: { key: 'id', descending: true }, onSort });

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'name', descending: false });
    expect(screen.queryByRole('button', { name: /Id/ })).not.toBeInTheDocument();
  });
});

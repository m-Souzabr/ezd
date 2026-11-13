import type { ReactNode } from 'react';

import type { Sort } from './sort';

export type Column<Row> = {
  /** The key sent to the server to sort by. A column without one cannot be sorted. */
  key: string;
  header: string;
  cell(row: Row): ReactNode;
  sortable?: boolean;
};

/**
 * A table of rows with sortable headers and states for loading, failure and no rows. A sort
 * header is a button, so the keyboard works; `aria-sort` says which column is sorted.
 */
export function Table<Row>({
  label,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  loading = false,
  error,
  empty = 'Nothing to show.',
}: {
  label: string;
  columns: Column<Row>[];
  rows: Row[] | undefined;
  rowKey(row: Row): string | number;
  sort?: Sort;
  onSort?(sort: Sort): void;
  loading?: boolean;
  error?: string | null;
  empty?: string;
}) {
  const span = columns.length;
  const status = (text: string, role: 'status' | 'alert') => (
    <tr>
      <td colSpan={span} role={role} className="px-3 py-6 text-center text-sm text-slate-600">
        {text}
      </td>
    </tr>
  );
  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 uppercase">
          <tr>
            {columns.map((column) => {
              const sorted = sort?.key === column.key;
              const sortable = column.sortable && onSort;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className="px-3 py-2 font-semibold"
                  aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="font-semibold uppercase hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500"
                      onClick={() =>
                        onSort({ key: column.key, descending: sorted && !sort.descending })
                      }
                    >
                      {column.header}
                      {sorted && <span aria-hidden="true">{sort.descending ? ' ▼' : ' ▲'}</span>}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {error
            ? status(error, 'alert')
            : loading
              ? status('Loading…', 'status')
              : rows?.length === 0
                ? status(empty, 'status')
                : rows?.map((row) => (
                    <tr key={rowKey(row)} className="hover:bg-slate-50">
                      {columns.map((column) => (
                        <td key={column.key} className="px-3 py-2 align-top">
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
        </tbody>
      </table>
    </div>
  );
}

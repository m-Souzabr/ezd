import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type DataListColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  primary?: boolean;
  desktopOnly?: boolean;
  /** The header is a button that asks for this column to be sorted. Needs `onSortChange`. */
  sortable?: boolean;
};

/** The column a list is sorted by. The caller owns it and does the sorting. */
export type DataListSort = { id: string; descending: boolean };

type DataListProps<T> = {
  caption: string;
  rows: T[];
  columns: DataListColumn<T>[];
  getRowId: (row: T) => string;
  rowActions?: (row: T) => ReactNode;
  sort?: DataListSort;
  onSortChange?: (sort: DataListSort) => void;
};

/**
 * Cards under 768 px and a table from 768 px, switched by CSS only, so both are in the
 * document. The caller passes rows already sorted; the cards say which sort is active.
 */
export function DataList<T>({
  caption,
  rows,
  columns,
  getRowId,
  rowActions,
  sort,
  onSortChange,
}: DataListProps<T>) {
  const primary = columns.find((column) => column.primary) ?? columns[0];
  if (!primary) return null;
  const secondary = columns.filter((column) => column !== primary);
  const sortedColumn = sort ? columns.find((column) => column.id === sort.id) : undefined;

  return (
    <>
      <div className="flex flex-col gap-3 md:hidden">
        {sort && sortedColumn ? (
          <p className="text-xs text-muted-foreground">
            Sorted by {sortedColumn.header}, {sort.descending ? 'descending' : 'ascending'}
          </p>
        ) : null}
        <ul aria-label={caption} className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={getRowId(row)}>
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{primary.cell(row)}</div>
                    {rowActions ? rowActions(row) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {secondary.map((column) => (
                      <div key={column.id}>
                        <dt className="text-xs text-muted-foreground">{column.header}</dt>
                        <dd>{column.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>

      <div className="hidden md:block">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => {
                const sorted = sort?.id === column.id;
                return (
                  <TableHead
                    key={column.id}
                    aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : undefined}
                    className={cn(column.desktopOnly && 'hidden lg:table-cell')}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                        onClick={() =>
                          onSortChange({ id: column.id, descending: sorted && !sort.descending })
                        }
                      >
                        {column.header}
                        {sorted ? (
                          <span aria-hidden="true">{sort.descending ? '▼' : '▲'}</span>
                        ) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
              {rowActions ? (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={getRowId(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      column.primary && 'font-medium',
                      column.desktopOnly && 'hidden lg:table-cell',
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
                {rowActions ? <TableCell>{rowActions(row)}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

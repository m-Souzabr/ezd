import { bomToCsv, computeBom, finishName, formatMoney, formatQuantity } from '@ezd/core';
import { DownloadIcon } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { sizeText } from '../../quotes/format';
import { useDesign, useDesignStore } from '../../store/context';

function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'design'} materials.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const CELL = 'align-top whitespace-normal';
const NUMBER = 'text-right align-top tabular-nums';

/**
 * The bill of materials of the design on screen, recomputed on every change. A line
 * selects the items it counts.
 */
export function BomPanel() {
  const store = useDesignStore();
  const doc = useDesign((state) => state.doc);
  const catalog = useDesign((state) => state.catalog);
  const selection = useDesign((state) => state.selection);
  const lines = useMemo(() => computeBom(doc, catalog), [doc, catalog]);
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

  return (
    <section aria-label="Bill of materials" className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-1.5">
        <h2 className="mr-auto text-xs font-semibold tracking-wide uppercase">Bill of materials</h2>
        <span className="text-sm">
          Subtotal <strong data-testid="bom-subtotal">{formatMoney(subtotal)}</strong>
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={lines.length === 0}
          onClick={() => downloadCsv(doc.name, bomToCsv(lines, catalog))}
        >
          <DownloadIcon aria-hidden="true" />
          Export CSV
        </Button>
      </div>
      {lines.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Nothing to count yet. Add cabinets or countertops to the design.
        </p>
      ) : (
        <div className="min-h-0 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={NUMBER}>Qty</TableHead>
                <TableHead className={CELL}>Description</TableHead>
                <TableHead className={CELL}>W x H x D</TableHead>
                <TableHead className={CELL}>Finish</TableHead>
                <TableHead className={NUMBER}>Unit price</TableHead>
                <TableHead className={NUMBER}>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const selected =
                  selection.length === line.itemIds.length &&
                  line.itemIds.every((id) => selection.includes(id));
                return (
                  <TableRow key={line.key} data-state={selected ? 'selected' : undefined}>
                    <TableCell className={NUMBER}>
                      {formatQuantity(line)}
                      {line.unit === 'sqft' && (
                        <span className="text-muted-foreground"> sq ft</span>
                      )}
                    </TableCell>
                    <TableCell className={CELL}>
                      <Button
                        variant="link"
                        className="h-auto p-0 text-left whitespace-normal"
                        aria-pressed={selected}
                        title="Select these in the drawing"
                        onClick={() => store.getState().select([...line.itemIds])}
                      >
                        {line.description}
                      </Button>
                    </TableCell>
                    <TableCell className={CELL}>{sizeText(line)}</TableCell>
                    <TableCell className={CELL}>{finishName(catalog, line.finishId)}</TableCell>
                    <TableCell className={NUMBER}>{formatMoney(line.unitPriceCents)}</TableCell>
                    <TableCell className={NUMBER}>{formatMoney(line.lineTotalCents)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

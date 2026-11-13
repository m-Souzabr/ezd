import { bomToCsv, computeBom, finishName, formatMoney, formatQuantity } from '@ezd/core';
import { useMemo } from 'react';

import { sizeText } from '../../quotes/format';

import { useDesign, useDesignStore } from '../../store/context';
import { BUTTON } from './fields';

function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'design'} materials.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const CELL = 'px-2 py-1 text-left align-top';
const NUMBER = 'px-2 py-1 text-right align-top tabular-nums';

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
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <h2 className="mr-auto text-xs font-semibold tracking-wide text-slate-600 uppercase">
          Bill of materials
        </h2>
        <span className="text-sm">
          Subtotal <strong data-testid="bom-subtotal">{formatMoney(subtotal)}</strong>
        </span>
        <button
          type="button"
          className={BUTTON}
          disabled={lines.length === 0}
          onClick={() => downloadCsv(doc.name, bomToCsv(lines, catalog))}
        >
          Export CSV
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="px-3 py-2 text-sm text-slate-600">
          Nothing to count yet. Add cabinets or countertops to the design.
        </p>
      ) : (
        <div className="min-h-0 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-xs text-slate-600">
              <tr>
                <th scope="col" className={NUMBER}>
                  Qty
                </th>
                <th scope="col" className={CELL}>
                  Description
                </th>
                <th scope="col" className={CELL}>
                  W x H x D
                </th>
                <th scope="col" className={CELL}>
                  Finish
                </th>
                <th scope="col" className={NUMBER}>
                  Unit price
                </th>
                <th scope="col" className={NUMBER}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const selected =
                  selection.length === line.itemIds.length &&
                  line.itemIds.every((id) => selection.includes(id));
                return (
                  <tr
                    key={line.key}
                    className={`border-t border-slate-100 ${selected ? 'bg-sky-50' : ''}`}
                  >
                    <td className={NUMBER}>
                      {formatQuantity(line)}
                      {line.unit === 'sqft' && <span className="text-slate-500"> sq ft</span>}
                    </td>
                    <td className={CELL}>
                      <button
                        type="button"
                        className="text-left text-sky-800 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-sky-500"
                        aria-pressed={selected}
                        title="Select these in the drawing"
                        onClick={() => store.getState().select([...line.itemIds])}
                      >
                        {line.description}
                      </button>
                    </td>
                    <td className={`${CELL} whitespace-nowrap`}>{sizeText(line)}</td>
                    <td className={CELL}>{finishName(catalog, line.finishId)}</td>
                    <td className={NUMBER}>{formatMoney(line.unitPriceCents)}</td>
                    <td className={NUMBER}>{formatMoney(line.lineTotalCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

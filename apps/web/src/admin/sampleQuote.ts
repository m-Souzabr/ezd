import { computeQuote, type QuoteBranding, type QuoteSettings } from '@ezd/core';

import type { Quote } from '../api/client';

/** A quote made up for the Control Panel's PDF preview, with the branding being edited. */
export function sampleQuote(branding: QuoteBranding, settings: QuoteSettings, plan: string): Quote {
  const line = (
    key: string,
    description: string,
    quantity: number,
    unitPriceCents: number,
    width: number,
  ): Quote['lines'][number] => ({
    key,
    catalogId: 'base.standard',
    description,
    width,
    height: 552,
    depth: 384,
    finishId: 'cabinet.white',
    finishName: 'White',
    options: {},
    quantity,
    unit: 'each',
    unitPriceCents,
    lineTotalCents: quantity * unitPriceCents,
    itemIds: [],
  });
  const lines = [
    line('sample-base', 'Base cabinet, 2 doors', 3, 32500, 480),
    line('sample-drawers', 'Drawer base cabinet', 2, 41000, 384),
  ];
  return {
    id: 'sample',
    number: 1,
    project_name: 'Sample project',
    design: 'sample',
    design_name: 'Sample kitchen',
    design_version: 1,
    customer_name: 'Sample Customer',
    customer_email: 'customer@example.com',
    customer_address: '1 Example Street',
    notes: 'This is a preview. Real quotes use your design and prices.',
    catalog_version: 'preview',
    settings,
    lines,
    totals: computeQuote(lines, settings),
    drawings: { plan, elevations: [] },
    branding,
    created_at: '2026-01-15T12:00:00Z',
  };
}

import type { ItemKind, Pt, Severity } from '@ezd/core';

// Colours for the plan and the elevation.

export const COLORS = {
  gridMinor: '#eef2f6',
  gridMajor: '#dbe2ea',
  floor: '#faf8f4',
  wall: '#475569',
  opening: '#ffffff',
  openingLine: '#64748b',
  countertop: 'rgba(148, 163, 184, 0.28)',
  countertopLine: '#94a3b8',
  itemLine: '#334155',
  label: '#0f172a',
  dimension: '#64748b',
  selection: '#0284c7',
  guide: '#c026d3',
  ghost: 'rgba(2, 132, 199, 0.22)',
  ghostError: 'rgba(220, 38, 38, 0.25)',
  error: '#dc2626',
  warning: '#d97706',
  backsplash: 'rgba(14, 165, 233, 0.08)',
} as const;

export const ITEM_FILL: Record<ItemKind, string> = {
  base: '#dbeafe',
  wall: 'rgba(254, 240, 138, 0.55)',
  tall: '#dcfce7',
  corner: '#e0e7ff',
  appliance: '#e2e8f0',
  filler: '#f1f5f9',
  panel: '#f1f5f9',
};

/** The outline colour for an item with violations: red for errors, amber for warnings. */
export const severityColor = (severity: Severity | undefined): string | undefined =>
  severity === 'error' ? COLORS.error : severity === 'warning' ? COLORS.warning : undefined;

export const flat = (points: readonly Pt[]): number[] => points.flatMap((p) => [p.x, p.y]);

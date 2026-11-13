import type { AppConfig, ItemKind, Pt, Severity } from '@ezd/core';

// Colours for the plan and the elevation. The opaque ones are the app config's `theme`
// section, set by `applyTheme` before an editor opens; the translucent ones stay here.

type ColorName =
  | keyof AppConfig['theme']['plan']
  | 'countertop'
  | 'ghost'
  | 'ghostError'
  | 'backsplash'
  | 'proposalAdded'
  | 'proposalAddedLine'
  | 'proposalRemoved'
  | 'proposalRemovedLine';

/** `#rrggbbaa` as `rgba()`, which every canvas colour parser reads. */
export const cssColor = (color: string): string => {
  if (color.length !== 9) return color;
  const [r, g, b, a] = [1, 3, 5, 7].map((i) => parseInt(color.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Number(((a ?? 255) / 255).toFixed(2))})`;
};

export const COLORS: Record<string, string> & Record<ColorName, string> = {
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
  /** A pending proposal: what it adds, and what it removes. */
  proposalAdded: 'rgba(22, 163, 74, 0.3)',
  proposalAddedLine: '#15803d',
  proposalRemoved: 'rgba(220, 38, 38, 0.2)',
  proposalRemovedLine: '#b91c1c',
  error: '#dc2626',
  warning: '#d97706',
  backsplash: 'rgba(14, 165, 233, 0.08)',
};

export const ITEM_FILL: Record<ItemKind, string> = {
  base: '#dbeafe',
  wall: 'rgba(254, 240, 138, 0.55)',
  tall: '#dcfce7',
  corner: '#e0e7ff',
  appliance: '#e2e8f0',
  filler: '#f1f5f9',
  panel: '#f1f5f9',
};

export function applyTheme(theme: AppConfig['theme']): void {
  Object.assign(COLORS, theme.plan);
  for (const kind of Object.keys(ITEM_FILL) as ItemKind[]) {
    ITEM_FILL[kind] = cssColor(theme.itemFill[kind]);
  }
}

/** The outline colour for an item with violations: red for errors, amber for warnings. */
export const severityColor = (severity: Severity | undefined): string | undefined =>
  severity === 'error' ? COLORS.error : severity === 'warning' ? COLORS.warning : undefined;

export const flat = (points: readonly Pt[]): number[] => points.flatMap((p) => [p.x, p.y]);

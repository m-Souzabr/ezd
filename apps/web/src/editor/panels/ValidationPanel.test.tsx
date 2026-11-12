import { inches } from '@ezd/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { room, seedItem, storeFor, WALLS } from '../../test/kitchen';
import { renderWithStore } from '../../test/render';
import { ValidationPanel } from './ValidationPanel';

const [A] = WALLS;
const base = (id: string, offset: number) => seedItem(id, 'base.standard', A, offset);

describe('ValidationPanel', () => {
  it('says so when there are no problems', () => {
    renderWithStore(<ValidationPanel />, storeFor(room()));
    expect(screen.getByText('No problems found.')).toBeInTheDocument();
  });

  it('groups the violations by severity, errors first', () => {
    // Two overlapping cabinets are an error. The island in front of them is too close: a
    // warning. A run with no countertop is a suggestion.
    const island = {
      ...base('item-000003', 0),
      placement: { type: 'free' as const, x: inches(12), y: inches(48), rotation: 0 },
    };
    const store = storeFor(
      room(144, 120, base('item-000001', 12), base('item-000002', 24), island),
    );
    renderWithStore(<ValidationPanel />, store);

    const { violations } = store.getState();
    const errors = violations.filter((violation) => violation.severity === 'error');
    const group = screen.getByRole('region', { name: 'Errors' });
    expect(within(group).getByText(`Errors (${errors.length})`)).toBeInTheDocument();
    expect(within(group).getByText('item.overlap')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.map((heading) => heading?.replace(/ \(\d+\)$/, ''))).toEqual([
      'Errors',
      'Warnings',
      'Suggestions',
    ]);
  });

  it('selects the items of a violation when it is clicked', () => {
    const store = storeFor(room(144, 120, base('item-000001', 12), base('item-000002', 24)));
    renderWithStore(<ValidationPanel />, store);
    const overlap = store.getState().violations.find((v) => v.ruleId === 'item.overlap')!;

    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`^${escape(overlap.message)}`) }),
    );

    expect(store.getState().selection).toEqual(overlap.itemIds);
  });

  it('frames the items in the plan once the canvas has been measured', () => {
    const store = storeFor(room(144, 120, base('item-000001', 12), base('item-000002', 24)));
    store.getState().setCanvasSize({ width: 800, height: 600 });
    const before = store.getState().viewport;
    renderWithStore(<ValidationPanel />, store);
    const overlap = store.getState().violations.find((v) => v.ruleId === 'item.overlap')!;

    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`^${escape(overlap.message)}`) }),
    );

    const { viewport } = store.getState();
    expect(viewport).not.toEqual(before);
    // The two cabinets span 12 in to 54 in along the top wall: their middle is centred.
    expect(viewport.offsetX + 33 * viewport.scale).toBeCloseTo(400, 6);
  });

  it('applies a fix with the Apply button, as one undo step', () => {
    // A 3 in gap between two cabinets: too narrow for a cabinet, so it needs a filler.
    const store = storeFor(room(144, 120, base('item-000001', 0), base('item-000002', 33)));
    renderWithStore(<ValidationPanel />, store);
    const gap = store.getState().violations.find((v) => v.ruleId === 'gap.needs-filler')!;
    expect(gap.fix).toBeDefined();

    const row = document.querySelector('[data-rule-id="gap.needs-filler"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /^Apply/ }));

    const state = store.getState();
    expect(state.history.past).toHaveLength(1);
    expect(state.violations.some((v) => v.ruleId === 'gap.needs-filler')).toBe(false);
    expect(state.doc.items).toHaveLength(3);
    expect(state.doc.items[2]).toMatchObject({
      kind: 'filler',
      width: inches(3),
      placement: { type: 'wall', wallId: A, offset: inches(30) },
    });
    expect(document.querySelector('[data-rule-id="gap.needs-filler"]')).toBeNull();

    state.undo();
    expect(store.getState().doc.items).toHaveLength(2);
  });

  it('has no Apply button for a violation without a fix', () => {
    const store = storeFor(room(144, 120, base('item-000001', 12), base('item-000002', 24)));
    renderWithStore(<ValidationPanel />, store);
    const row = document.querySelector('[data-rule-id="item.overlap"]') as HTMLElement;
    expect(within(row).queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument();
  });
});

/** Escapes a message for use in a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

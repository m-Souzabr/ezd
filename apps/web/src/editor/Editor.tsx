import { type DesignDocument, itemLabel, wallLabel } from '@ezd/core';
import { useEffect } from 'react';

import { handleGlobalKey, isTyping } from '../lib/shortcuts';
import { useDesign, useDesignStore } from '../store/context';
import type { DesignStore } from '../store/designStore';
import { ElevationCanvas } from './elevation/ElevationCanvas';
import { CatalogPanel } from './panels/CatalogPanel';
import { BUTTON } from './panels/fields';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { Toolbar } from './panels/Toolbar';
import { ValidationPanel } from './panels/ValidationPanel';
import { PlanCanvas } from './plan/PlanCanvas';
import { findTarget } from './tools/select';

/** What a screen reader hears when the selection changes. */
function announcement(state: DesignStore): string {
  const { doc, catalog, selection } = state;
  if (selection.length === 0) return '';
  if (selection.length > 1) return `${selection.length} things selected`;
  const target = findTarget(doc, selection[0]!);
  switch (target?.kind) {
    case 'item':
      return `${itemLabel(doc, catalog, target.item)}, selected`;
    case 'opening':
      return `${target.opening.kind} on wall ${wallLabel(doc, target.opening.wallId)}, selected`;
    case 'wall':
      return `Wall ${wallLabel(doc, target.id)}, selected`;
    case 'countertop':
      return `Countertop on wall ${wallLabel(doc, target.countertop.wallId)}, selected`;
    default:
      return '';
  }
}

/**
 * The editor screen: the toolbar across the top, the catalog on the left, the plan or an
 * elevation in the middle, and the properties and validation panels on the right.
 */
export function Editor({ onLoadDocument }: { onLoadDocument(doc: DesignDocument): void }) {
  const store = useDesignStore();
  const view = useDesign((state) => state.view);
  const notice = useDesign((state) => state.notice);
  const selected = useDesign(announcement);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A text field keeps its own editing keys, and a dialog its own Escape.
      if (event.key !== 'Escape' && isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (handleGlobalKey(event, store)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 pt-2">
        <h1 className="text-base font-semibold tracking-tight">EZDesign</h1>
      </header>
      <Toolbar onLoadDocument={onLoadDocument} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          <CatalogPanel />
        </aside>
        <main className="relative min-w-0 flex-1">
          {view.kind === 'plan' ? <PlanCanvas /> : <ElevationCanvas wallId={view.wallId} />}
          <p id="canvas-help" className="sr-only">
            Press Tab to step through the items in wall order. Arrow keys move the selected item 3
            inches; with Shift, a filler moves 1/16 inch. Delete removes the selection. Hold Space
            and drag to pan.
          </p>
          {notice && (
            <div
              role="status"
              className="absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[90%] items-center gap-3 rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
            >
              <span>{notice}</span>
              <button
                type="button"
                className={`${BUTTON} border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-white hover:bg-slate-700`}
                onClick={() => store.getState().notify(null)}
              >
                Dismiss
              </button>
            </div>
          )}
        </main>
        <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PropertiesPanel />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-slate-200">
            <ValidationPanel />
          </div>
        </aside>
      </div>
      <p aria-live="polite" className="sr-only" data-testid="announcement">
        {selected}
      </p>
    </div>
  );
}

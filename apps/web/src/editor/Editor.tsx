import { type DesignDocument, itemLabel, wallLabel } from '@ezd/core';
import { type ReactNode, useEffect, useState } from 'react';

import { handleGlobalKey, isTyping } from '../lib/shortcuts';
import { useDesign, useDesignStore } from '../store/context';
import type { DesignStore } from '../store/designStore';
import { ElevationCanvas } from './elevation/ElevationCanvas';
import { CatalogPanel } from './panels/CatalogPanel';
import { BomPanel } from './panels/BomPanel';
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
 * elevation in the middle, the properties and validation panels on the right, and the
 * assistant beyond them when there is one.
 */
export function Editor({
  onLoadDocument,
  header,
  assistant,
}: {
  onLoadDocument(doc: DesignDocument): void;
  /** Shown in the header after the title: where the design is kept, and links away. */
  header?: ReactNode;
  /** The chat assistant, docked at the right. Only a design saved on the server has one. */
  assistant?: ReactNode;
}) {
  const store = useDesignStore();
  const view = useDesign((state) => state.view);
  const notice = useDesign((state) => state.notice);
  const previewDoc = useDesign((state) => state.proposal?.doc);
  const selected = useDesign(announcement);
  const [materialsOpen, setMaterialsOpen] = useState(false);

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
        {header}
      </header>
      <Toolbar
        onLoadDocument={onLoadDocument}
        materialsOpen={materialsOpen}
        onToggleMaterials={() => setMaterialsOpen((open) => !open)}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          <CatalogPanel />
        </aside>
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {view.kind === 'plan' ? (
              <PlanCanvas previewDoc={previewDoc} />
            ) : (
              <ElevationCanvas wallId={view.wallId} previewDoc={previewDoc} />
            )}
          </div>
          {materialsOpen && (
            <div className="flex max-h-[40%] min-h-0 flex-col border-t border-slate-200 bg-white">
              <BomPanel />
            </div>
          )}
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
        {assistant && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
            {assistant}
          </aside>
        )}
      </div>
      <p aria-live="polite" className="sr-only" data-testid="announcement">
        {selected}
      </p>
    </div>
  );
}

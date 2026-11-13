import { type DesignDocument, wallLabel } from '@ezd/core';
import { useMemo } from 'react';

import { useCatalog } from '../catalog/useCatalog';
import { useRulesConfig } from '../config/useConfig';
import { DesignStoreProvider, useDesign, useDesignStore } from '../store/context';
import { createDesignStore, type View } from '../store/designStore';
import { ElevationCanvas } from './elevation/ElevationCanvas';
import { BUTTON } from './panels/fields';
import { PlanCanvas } from './plan/PlanCanvas';

function PreviewViews() {
  const store = useDesignStore();
  const doc = useDesign((state) => state.doc);
  const view = useDesign((state) => state.view);

  // The canvas frames the view itself when it changes.
  const show = (next: View) => store.getState().setView(next);
  const pressed = (on: boolean) => `${BUTTON} ${on ? 'border-sky-700 bg-sky-700 text-white' : ''}`;

  return (
    <>
      <div
        role="group"
        aria-label="View"
        className="flex gap-1 border-b border-slate-200 bg-white px-3 py-2"
      >
        <button
          type="button"
          className={pressed(view.kind === 'plan')}
          aria-pressed={view.kind === 'plan'}
          onClick={() => show({ kind: 'plan' })}
        >
          Plan
        </button>
        {doc.room.walls.map((wall) => {
          const on = view.kind === 'elevation' && view.wallId === wall.id;
          return (
            <button
              key={wall.id}
              type="button"
              className={pressed(on)}
              aria-pressed={on}
              aria-label={`Elevation ${wallLabel(doc, wall.id)}`}
              onClick={() => show({ kind: 'elevation', wallId: wall.id })}
            >
              {wallLabel(doc, wall.id)}
            </button>
          );
        })}
      </div>
      {/* Inert: the drawing takes no pointer or key input, so nothing here can be edited. */}
      <div inert className="relative min-h-0 flex-1" data-testid="version-preview">
        {view.kind === 'plan' ? <PlanCanvas /> : <ElevationCanvas wallId={view.wallId} />}
      </div>
    </>
  );
}

/**
 * A saved version, shown read-only in place of the editor. It has a store of its own, so
 * the draft, its history and its autosave are untouched while it is open.
 */
export function VersionPreview({
  document,
  number,
  label,
  restoring,
  onRestore,
  onClose,
}: {
  document: DesignDocument;
  number: number;
  label: string;
  restoring: boolean;
  onRestore(): void;
  onClose(): void;
}) {
  const catalog = useCatalog();
  const rules = useRulesConfig();
  const store = useMemo(
    () => createDesignStore(document, catalog, rules),
    [document, catalog, rules],
  );
  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-3 py-2">
        <h1 className="text-base font-semibold tracking-tight">
          Version {number}
          {label && <span className="font-normal"> · {label}</span>}
        </h1>
        <p className="mr-auto text-sm text-amber-900">Read-only preview of a saved version.</p>
        <button type="button" className={BUTTON} disabled={restoring} onClick={onRestore}>
          Restore this version
        </button>
        <button type="button" className={BUTTON} onClick={onClose}>
          Back to the draft
        </button>
      </header>
      <DesignStoreProvider store={store}>
        <PreviewViews />
      </DesignStoreProvider>
    </div>
  );
}

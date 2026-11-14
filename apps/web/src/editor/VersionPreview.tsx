import { type DesignDocument, wallLabel } from '@ezd/core';
import { EyeIcon } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCatalog } from '../catalog/useCatalog';
import { useRulesConfig } from '../config/useConfig';
import { DesignStoreProvider, useDesign, useDesignStore } from '../store/context';
import { createDesignStore, type View } from '../store/designStore';
import { ElevationCanvas } from './elevation/ElevationCanvas';
import { PlanCanvas } from './plan/PlanCanvas';

function PreviewViews() {
  const store = useDesignStore();
  const doc = useDesign((state) => state.doc);
  const view = useDesign((state) => state.view);

  // The canvas frames the view itself when it changes.
  const show = (next: View) => store.getState().setView(next);

  return (
    <>
      <div
        role="group"
        aria-label="View"
        className="flex gap-1 overflow-x-auto border-b bg-card px-3 py-2 *:shrink-0"
      >
        <Button
          variant={view.kind === 'plan' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={view.kind === 'plan'}
          onClick={() => show({ kind: 'plan' })}
        >
          Plan
        </Button>
        {doc.room.walls.map((wall) => {
          const on = view.kind === 'elevation' && view.wallId === wall.id;
          return (
            <Button
              key={wall.id}
              variant={on ? 'default' : 'outline'}
              size="sm"
              aria-pressed={on}
              aria-label={`Elevation ${wallLabel(doc, wall.id)}`}
              onClick={() => show({ kind: 'elevation', wallId: wall.id })}
            >
              {wallLabel(doc, wall.id)}
            </Button>
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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted px-3 py-2">
        <h1 className="text-base font-semibold tracking-tight">
          Version {number}
          {label && <span className="font-normal"> · {label}</span>}
        </h1>
        <Badge variant="outline">
          <EyeIcon aria-hidden="true" />
          Read-only
        </Badge>
        <p className="mr-auto text-sm">Read-only preview of a saved version.</p>
        <Button disabled={restoring} onClick={onRestore}>
          Restore this version
        </Button>
        <Button variant="outline" onClick={onClose}>
          Back to the draft
        </Button>
      </header>
      <DesignStoreProvider store={store}>
        <PreviewViews />
      </DesignStoreProvider>
    </div>
  );
}

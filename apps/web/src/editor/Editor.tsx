import { type DesignDocument, itemLabel, wallLabel } from '@ezd/core';
import { MessageSquareIcon, PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/use-media-query';
import { LG_UP, MD_UP } from '@/lib/breakpoints';
import { useConfig } from '../config/useConfig';
import { handleGlobalKey, isTyping } from '../lib/shortcuts';
import { useDesign, useDesignStore } from '../store/context';
import type { DesignStore } from '../store/designStore';
import { ElevationCanvas } from './elevation/ElevationCanvas';
import { CatalogPanel } from './panels/CatalogPanel';
import { BomPanel } from './panels/BomPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { Toolbar } from './panels/Toolbar';
import { ValidationPanel } from './panels/ValidationPanel';
import type { SheetName } from './EditorOverlays';
import { PlanCanvas } from './plan/PlanCanvas';
import { findTarget } from './tools/select';

// The sheets and the drawer exist only below 1024 px; the desktop editor never loads them.
const EditorOverlays = lazy(() => import('./EditorOverlays'));

/** Whether a dialog, alert dialog, sheet or drawer is open. A closed one kept mounted is hidden. */
const openDialog = (): boolean =>
  document.querySelector('[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])') !==
  null;

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
  const { panels, features, toolbar } = useConfig();
  const [materialsOpen, setMaterialsOpen] = useState(false);
  // Only a properties window that starts collapsed can be opened and closed.
  const [propertiesOpen, setPropertiesOpen] = useState(!panels.properties.defaultCollapsed);
  const lgUp = useMediaQuery(LG_UP);
  const mdUp = useMediaQuery(MD_UP);
  /** The panel open as a sheet. Below 1024 px the panels are sheets; from there up, columns. */
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const showAssistant = Boolean(features.assistant && assistant);
  const showRight = panels.properties.visible || panels.validation.visible;
  const showMaterials = materialsOpen && panels.materials.visible;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A text field keeps its own editing keys, and a dialog, sheet or drawer its own Escape.
      if (event.key !== 'Escape' && isTyping(event.target)) return;
      if (openDialog()) return;
      if (handleGlobalKey(event, store, toolbar.buttons)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, toolbar.buttons]);

  const properties =
    panels.properties.visible &&
    (panels.properties.defaultCollapsed && !propertiesOpen ? (
      <Button
        variant="outline"
        aria-expanded={false}
        className="m-2 justify-between"
        onClick={() => setPropertiesOpen(true)}
      >
        Show properties
      </Button>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {panels.properties.defaultCollapsed && (
          <Button
            variant="outline"
            aria-expanded
            className="m-2 justify-between"
            onClick={() => setPropertiesOpen(false)}
          >
            Hide properties
          </Button>
        )}
        <PropertiesPanel />
      </div>
    ));
  const rightPanels = (
    <>
      {properties}
      {panels.validation.visible && (
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            panels.properties.visible ? 'border-t' : ''
          }`}
        >
          <ValidationPanel />
        </div>
      )}
    </>
  );

  const panelButtons = !lgUp && (
    <>
      {panels.catalog.visible && (
        <Button
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => setSheet('catalog')}
        >
          <PanelLeftIcon aria-hidden="true" />
          Catalog
        </Button>
      )}
      {showRight && (
        <Button
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => setSheet('properties')}
        >
          <PanelRightIcon aria-hidden="true" />
          Properties
        </Button>
      )}
      {showAssistant && (
        <Button
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => setSheet('assistant')}
        >
          <MessageSquareIcon aria-hidden="true" />
          Assistant
        </Button>
      )}
    </>
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-card px-3 py-2">
        <h1 className="text-base font-semibold tracking-tight">EZDesign</h1>
        {header}
      </header>
      <Toolbar
        onLoadDocument={onLoadDocument}
        materialsOpen={materialsOpen}
        onToggleMaterials={() => setMaterialsOpen((open) => !open)}
        panelButtons={panelButtons}
      />
      <div className="flex min-h-0 flex-1">
        {lgUp && panels.catalog.visible && (
          <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r bg-card">
            <CatalogPanel />
          </aside>
        )}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {view.kind === 'plan' ? (
              <PlanCanvas previewDoc={previewDoc} />
            ) : (
              <ElevationCanvas wallId={view.wallId} previewDoc={previewDoc} />
            )}
          </div>
          {showMaterials && mdUp && (
            <div className="flex max-h-[40%] min-h-0 flex-col border-t bg-card">
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
              className="absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[90%] items-center gap-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg"
            >
              <span>{notice}</span>
              <Button variant="secondary" size="xs" onClick={() => store.getState().notify(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </main>
        {lgUp && showRight && (
          <aside className="flex w-72 shrink-0 flex-col border-l bg-card">{rightPanels}</aside>
        )}
        {lgUp && showAssistant && (
          <aside className="flex w-80 shrink-0 flex-col border-l bg-card">{assistant}</aside>
        )}
      </div>
      {(!lgUp || !mdUp) && (
        <Suspense fallback={null}>
          <EditorOverlays
            sheet={lgUp ? null : sheet}
            onSheetChange={setSheet}
            catalog={
              !lgUp && panels.catalog.visible ? (
                <CatalogPanel onAdded={() => setSheet(null)} />
              ) : null
            }
            right={!lgUp && showRight ? rightPanels : null}
            assistant={!lgUp && showAssistant ? assistant : null}
            materials={!mdUp && showMaterials ? <BomPanel /> : null}
            onMaterialsClose={() => setMaterialsOpen(false)}
          />
        </Suspense>
      )}
      <p aria-live="polite" className="sr-only" data-testid="announcement">
        {selected}
      </p>
    </div>
  );
}

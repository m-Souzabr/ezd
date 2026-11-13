import { type DesignDocument, proposeCountertops, wallLabel } from '@ezd/core';
import { Dialog, Toolbar as RadixToolbar } from 'radix-ui';
import { type ChangeEvent, useRef, useState } from 'react';

import { downloadDocument, type ReadError, readDocument } from '../../lib/repository';
import { useDesign, useDesignStore } from '../../store/context';
import type { Tool } from '../../store/designStore';
import { canRedo, canUndo, fitView } from '../../store/selectors';
import { asOne } from '../edits';
import type { OpeningToolKind } from '../tools/opening';
import { BUTTON } from './fields';
import { RoomTemplateDialog } from './RoomTemplateDialog';

const TOOLS: { tool: Tool; name: string; hint: string }[] = [
  { tool: 'select', name: 'Select', hint: 'Select, move and resize' },
  { tool: 'wall', name: 'Wall', hint: 'Draw walls: click each corner, double-click to finish' },
  { tool: 'opening', name: 'Opening', hint: 'Add a door or window: click a wall' },
  { tool: 'pan', name: 'Pan', hint: 'Drag to move the view' },
];

const PLAN = 'plan';

const separator = 'mx-1 h-6 w-px bg-slate-300';

export function Toolbar({
  onLoadDocument,
  materialsOpen,
  onToggleMaterials,
}: {
  onLoadDocument(doc: DesignDocument): void;
  materialsOpen: boolean;
  onToggleMaterials(): void;
}) {
  const store = useDesignStore();
  const doc = useDesign((state) => state.doc);
  const tool = useDesign((state) => state.tool);
  const openingKind = useDesign((state) => state.openingKind);
  const view = useDesign((state) => state.view);
  const undoable = useDesign(canUndo);
  const redoable = useDesign(canRedo);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<ReadError | null>(null);

  const fit = () => {
    const state = store.getState();
    if (state.canvasSize) state.setViewport(fitView(state.doc, state.view, state.canvasSize));
  };

  const generateCountertops = () => {
    const state = store.getState();
    const command = asOne(proposeCountertops(state.doc, state.catalog), 'Generate countertops');
    if (!command) {
      state.notify('Every run of base cabinets already has a countertop.');
      return;
    }
    const executed = state.execute(command);
    state.notify(executed.ok ? null : executed.error.message);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Lets the same file be chosen again after a failed import.
    event.target.value = '';
    if (!file) return;
    const read = readDocument(await file.text());
    if (read.ok) onLoadDocument(read.value);
    else setImportError(read.error);
  };

  return (
    <>
      <RadixToolbar.Root
        aria-label="Editor"
        className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-2"
      >
        <RadixToolbar.ToggleGroup
          type="single"
          aria-label="Tool"
          className="flex gap-1"
          value={tool}
          onValueChange={(value) => {
            if (value) store.getState().setTool(value as Tool);
          }}
        >
          {TOOLS.map(({ tool: value, name, hint }) => (
            <RadixToolbar.ToggleItem key={value} value={value} title={hint} className={BUTTON}>
              {name}
            </RadixToolbar.ToggleItem>
          ))}
        </RadixToolbar.ToggleGroup>

        {tool === 'opening' && (
          <RadixToolbar.ToggleGroup
            type="single"
            aria-label="Opening to add"
            className="ml-1 flex gap-1"
            value={openingKind}
            onValueChange={(value) => {
              if (value) store.getState().setOpeningKind(value as OpeningToolKind);
            }}
          >
            <RadixToolbar.ToggleItem value="door" className={BUTTON}>
              Door
            </RadixToolbar.ToggleItem>
            <RadixToolbar.ToggleItem value="window" className={BUTTON}>
              Window
            </RadixToolbar.ToggleItem>
          </RadixToolbar.ToggleGroup>
        )}

        <RoomTemplateDialog
          trigger={<RadixToolbar.Button className={BUTTON}>Room template</RadixToolbar.Button>}
        />

        <RadixToolbar.Separator className={separator} />
        <RadixToolbar.Button
          className={BUTTON}
          disabled={!undoable}
          onClick={() => store.getState().undo()}
        >
          Undo
        </RadixToolbar.Button>
        <RadixToolbar.Button
          className={BUTTON}
          disabled={!redoable}
          onClick={() => store.getState().redo()}
        >
          Redo
        </RadixToolbar.Button>

        <RadixToolbar.Separator className={separator} />
        <RadixToolbar.ToggleGroup
          type="single"
          aria-label="View"
          className="flex gap-1"
          value={view.kind === 'plan' ? PLAN : view.wallId}
          onValueChange={(value) => {
            if (!value) return;
            store
              .getState()
              .setView(value === PLAN ? { kind: 'plan' } : { kind: 'elevation', wallId: value });
          }}
        >
          <RadixToolbar.ToggleItem value={PLAN} className={BUTTON}>
            Plan
          </RadixToolbar.ToggleItem>
          {doc.room.walls.map((wall) => (
            <RadixToolbar.ToggleItem
              key={wall.id}
              value={wall.id}
              className={BUTTON}
              aria-label={`Elevation ${wallLabel(doc, wall.id)}`}
              title={`Elevation of wall ${wallLabel(doc, wall.id)}`}
            >
              {wallLabel(doc, wall.id)}
            </RadixToolbar.ToggleItem>
          ))}
        </RadixToolbar.ToggleGroup>
        <RadixToolbar.Button className={BUTTON} onClick={fit} title="Frame the whole view">
          Fit
        </RadixToolbar.Button>

        <RadixToolbar.Separator className={separator} />
        <RadixToolbar.Button className={BUTTON} onClick={generateCountertops}>
          Generate countertops
        </RadixToolbar.Button>
        <RadixToolbar.Button
          className={BUTTON}
          aria-pressed={materialsOpen}
          data-state={materialsOpen ? 'on' : 'off'}
          onClick={onToggleMaterials}
        >
          Materials
        </RadixToolbar.Button>
        <RadixToolbar.Button
          className={BUTTON}
          onClick={() => downloadDocument(store.getState().doc)}
        >
          Export JSON
        </RadixToolbar.Button>
        <RadixToolbar.Button className={BUTTON} onClick={() => fileInput.current?.click()}>
          Import JSON
        </RadixToolbar.Button>
      </RadixToolbar.Root>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        tabIndex={-1}
        aria-label="Design file to import"
        data-testid="import-file"
        onChange={(event) => void importFile(event)}
      />

      <Dialog.Root open={importError !== null} onOpenChange={() => setImportError(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[80vh] w-[28rem] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold text-slate-900">
              The file was not imported
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-slate-600">
              {importError?.issues.length
                ? 'It is not a valid design. Your current design is unchanged.'
                : importError?.message}
            </Dialog.Description>
            {importError && importError.issues.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-800">
                {importError.issues.map((issue, i) => (
                  <li key={i}>
                    {issue.path && <code className="font-mono text-xs">{issue.path}: </code>}
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <Dialog.Close asChild>
                <button type="button" className={BUTTON}>
                  Close
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

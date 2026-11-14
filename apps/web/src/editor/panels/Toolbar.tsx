import { type DesignDocument, proposeCountertops, wallLabel } from '@ezd/core';
import { Redo2Icon, Undo2Icon } from 'lucide-react';
import { type ChangeEvent, lazy, type ReactNode, Suspense, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useConfig } from '../../config/useConfig';
import { downloadDocument, type ReadError, readDocument } from '../../lib/repository';
import { useDesign, useDesignStore } from '../../store/context';
import type { Tool } from '../../store/designStore';
import { canRedo, canUndo, fitView } from '../../store/selectors';
import { asOne } from '../edits';
import type { OpeningToolKind } from '../tools/opening';
import { type Choice, ChoiceGroup, HintButton } from './controls';
import { HelpDialog } from './HelpDialog';
import { useRovingFocus } from './roving';
import { RoomTemplateDialog } from './RoomTemplateDialog';

// The dialog is loaded when a file is refused, which is rare.
const ImportErrorDialog = lazy(() => import('./ImportErrorDialog'));

const TOOLS: Choice<Tool>[] = [
  { value: 'select', label: 'Select', hint: 'Select, move and resize', shortcut: 'Esc' },
  {
    value: 'wall',
    label: 'Wall',
    hint: 'Draw walls: click each corner, double-click to finish',
  },
  { value: 'opening', label: 'Opening', hint: 'Add a door or window: click a wall' },
  { value: 'pan', label: 'Pan', hint: 'Drag to move the view', shortcut: 'Space + drag' },
];

const OPENINGS: Choice<OpeningToolKind>[] = [
  { value: 'door', label: 'Door' },
  { value: 'window', label: 'Window' },
];

const PLAN = 'plan';

const MOD = 'Ctrl+';

const Divider = () => <Separator orientation="vertical" className="mx-1 h-6" />;

export function Toolbar({
  onLoadDocument,
  materialsOpen,
  onToggleMaterials,
  panelButtons,
}: {
  onLoadDocument(doc: DesignDocument): void;
  materialsOpen: boolean;
  onToggleMaterials(): void;
  /** Buttons that open the side panels as sheets, which the editor passes below 1024 px. */
  panelButtons?: ReactNode;
}) {
  const store = useDesignStore();
  const { toolbar, panels, features } = useConfig();
  const { buttons } = toolbar;
  const doc = useDesign((state) => state.doc);
  const tool = useDesign((state) => state.tool);
  const openingKind = useDesign((state) => state.openingKind);
  const view = useDesign((state) => state.view);
  const undoable = useDesign(canUndo);
  const redoable = useDesign(canRedo);
  const fileInput = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useRovingFocus(toolbarRef);
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

  const views: Choice<string>[] = [
    { value: PLAN, label: 'Plan' },
    ...doc.room.walls.map((wall) => ({
      value: wall.id,
      label: wallLabel(doc, wall.id),
      name: `Elevation ${wallLabel(doc, wall.id)}`,
      hint: `Elevation of wall ${wallLabel(doc, wall.id)}`,
    })),
  ];

  return (
    <>
      {/* Scrolls sideways inside its own box on a narrow screen, so the page does not. */}
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Editor"
        className="flex items-center gap-1 overflow-x-auto border-b bg-card px-3 py-2 *:shrink-0"
      >
        {panelButtons}
        <ChoiceGroup
          label="Tool"
          value={tool}
          choices={TOOLS.filter((choice) => toolbar.tools[choice.value])}
          onChange={(value) => store.getState().setTool(value)}
        />

        {tool === 'opening' && (
          <ChoiceGroup
            label="Opening to add"
            className="ml-1 flex gap-1"
            value={openingKind}
            choices={OPENINGS}
            onChange={(value) => store.getState().setOpeningKind(value)}
          />
        )}

        {features.roomTemplates && (
          <RoomTemplateDialog
            trigger={
              <Button variant="outline" size="sm">
                Room template
              </Button>
            }
          />
        )}

        {buttons.undoRedo && (
          <>
            <Divider />
            <HintButton
              variant="outline"
              size="sm"
              disabled={!undoable}
              hint="Undo the last change"
              shortcut={`${MOD}Z`}
              onClick={() => store.getState().undo()}
            >
              <Undo2Icon aria-hidden="true" />
              Undo
            </HintButton>
            <HintButton
              variant="outline"
              size="sm"
              disabled={!redoable}
              hint="Redo the change you undid"
              shortcut={`${MOD}Shift+Z`}
              onClick={() => store.getState().redo()}
            >
              <Redo2Icon aria-hidden="true" />
              Redo
            </HintButton>
          </>
        )}

        <Divider />
        {buttons.views && (
          <ChoiceGroup
            label="View"
            value={view.kind === 'plan' ? PLAN : view.wallId}
            choices={views}
            onChange={(value) =>
              store
                .getState()
                .setView(value === PLAN ? { kind: 'plan' } : { kind: 'elevation', wallId: value })
            }
          />
        )}
        {buttons.fit && (
          <HintButton variant="outline" size="sm" hint="Frame the whole view" onClick={fit}>
            Fit
          </HintButton>
        )}

        <Divider />
        {buttons.countertops && (
          <Button variant="outline" size="sm" onClick={generateCountertops}>
            Generate countertops
          </Button>
        )}
        {panels.materials.visible && (
          <Button
            variant={materialsOpen ? 'default' : 'outline'}
            size="sm"
            aria-pressed={materialsOpen}
            onClick={onToggleMaterials}
          >
            Materials
          </Button>
        )}
        {features.jsonImportExport && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadDocument(store.getState().doc)}
            >
              Export JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              Import JSON
            </Button>
          </>
        )}
        {buttons.help && (
          <HelpDialog
            trigger={
              <Button variant="outline" size="sm">
                Help
              </Button>
            }
          />
        )}
      </div>

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

      {importError && (
        <Suspense fallback={null}>
          <ImportErrorDialog error={importError} onClose={() => setImportError(null)} />
        </Suspense>
      )}
    </>
  );
}

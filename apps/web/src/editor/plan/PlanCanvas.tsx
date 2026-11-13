import {
  type DesignDocument,
  formatLength,
  type Id,
  IN,
  type Item,
  itemFootprint,
  parseLength,
  type Point,
  type Pt,
  wallLength,
} from '@ezd/core';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { Layer, Stage } from 'react-konva';

import { useDesign, useDesignStore } from '../../store/context';
import { selectedId, severityById, violationsFor } from '../../store/selectors';
import { CanvasHost, type CanvasPointer } from '../CanvasHost';
import { type Drag, dragGhost, dragHasError } from '../dragging';
import { newId } from '../ids';
import { previewGhosts } from '../preview';
import { openingCommand } from '../tools/opening';
import { findTarget, handleAt, hitTest, isResizable, wallAt } from '../tools/select';
import { pointAtLength, snapWallPoint, WALL_SNAP_PX, wallCommands } from '../tools/wall';
import { pixels, visibleBounds } from '../viewport';
import {
  CountertopsLayer,
  DimensionsLayer,
  FloorLayer,
  GhostLayer,
  GridLayer,
  GuidesLayer,
  ItemsLayer,
  OpeningsLayer,
  ProposalLayer,
  SelectionLayer,
  WallDraftLayer,
  WallsLayer,
} from './layers';

const HIT_TOLERANCE_PX = 5;
const HANDLE_TOLERANCE_PX = 9;

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** From the point `snap` positions on the item to where the pointer grabbed it. */
function grabOffset(footprint: readonly Pt[], item: Item, point: Pt): Pt {
  // On a wall `snap` follows the middle of the item's back; in the open, its centre.
  const corners = item.placement.type === 'wall' ? footprint.slice(0, 2) : footprint;
  const x = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const y = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  return { x: point.x - x, y: point.y - y };
}

/**
 * The 2D plan: draws the room from above and turns pointer input into commands. With
 * `previewDoc`, the items that differ from the document are drawn over it as ghosts.
 */
export function PlanCanvas({ previewDoc }: { previewDoc?: DesignDocument | undefined } = {}) {
  const store = useDesignStore();
  const doc = useDesign((state) => state.doc);
  const catalog = useDesign((state) => state.catalog);
  const violations = useDesign((state) => state.violations);
  const selection = useDesign((state) => state.selection);
  const single = useDesign(selectedId);
  const drag = useDesign((state) => state.drag);
  const tool = useDesign((state) => state.tool);
  const draft = useDesign((state) => state.wallDraft);

  const [hover, setHover] = useState<{ id: Id; screen: Pt } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [lengthText, setLengthText] = useState('');
  const [lengthError, setLengthError] = useState<string | null>(null);
  const lengthInput = useRef<HTMLInputElement>(null);

  const severities = useMemo(() => severityById(violations), [violations]);
  const ghosts = useMemo(
    () => (previewDoc ? previewGhosts(doc, previewDoc) : null),
    [doc, previewDoc],
  );
  const selectedTarget = single ? findTarget(doc, single) : null;
  const selectedItem = selectedTarget?.kind === 'item' ? selectedTarget.item : undefined;

  /** Ends the wall being drawn: one `batch` of `wall.add`, or nothing for a single point. */
  const finishWalls = (points: readonly Point[]) => {
    const state = store.getState();
    const command = wallCommands(points, newId);
    setLengthText('');
    setLengthError(null);
    setCursor(null);
    if (command) {
      const executed = state.execute(command);
      state.notify(executed.ok ? null : executed.error.message);
    }
    state.setTool('select');
  };

  /** Adds a wall point. Coming back to the first point closes the room. */
  const addWallPoint = (point: Point) => {
    const state = store.getState();
    const points = [...state.wallDraft, point];
    if (points.length >= 4 && samePoint(point, points[0]!)) finishWalls(points);
    else state.setWallDraft(points);
  };

  const onPress = ({ point, shiftKey }: CanvasPointer): Drag | null => {
    const state = store.getState();
    const { viewport } = state;
    setHover(null);

    if (tool === 'wall') {
      addWallPoint(
        snapWallPoint(state.doc, state.wallDraft, point, pixels(viewport, WALL_SNAP_PX)),
      );
      return null;
    }
    if (tool === 'opening') {
      const hit = wallAt(state.doc, point, pixels(viewport, HIT_TOLERANCE_PX));
      if (!hit) {
        state.notify('Click a wall to add the opening.');
        return null;
      }
      const command = openingCommand(hit.wall, state.openingKind, hit.along, newId);
      const executed = state.execute(command);
      if (executed.ok && command.type === 'opening.add') state.select([command.opening.id]);
      state.notify(executed.ok ? null : executed.error.message);
      return null;
    }

    // The select tool. A handle of the selected item comes before whatever is under it.
    if (selectedItem && isResizable(selectedItem, state.catalog)) {
      const edge = handleAt(state.doc, selectedItem, point, pixels(viewport, HANDLE_TOLERANCE_PX));
      if (edge) {
        return { kind: 'resize', item: selectedItem, edge, width: selectedItem.width, snap: null };
      }
    }
    const hit = hitTest(state.doc, point, pixels(viewport, HIT_TOLERANCE_PX));
    if (!hit) {
      state.select([]);
      return null;
    }
    if (shiftKey) {
      state.select(
        selection.includes(hit.id)
          ? selection.filter((id) => id !== hit.id)
          : [...selection, hit.id],
      );
      return null;
    }
    state.select([hit.id]);
    if (hit.kind !== 'item') return null;
    const footprint = itemFootprint(state.doc, hit.item);
    return footprint
      ? { kind: 'move', item: hit.item, grab: grabOffset(footprint, hit.item, point), snap: null }
      : null;
  };

  const onHover = (pointer: CanvasPointer | null) => {
    if (!pointer) {
      setHover(null);
      return;
    }
    const state = store.getState();
    const { viewport } = state;
    if (tool === 'wall') {
      setCursor(
        snapWallPoint(state.doc, state.wallDraft, pointer.point, pixels(viewport, WALL_SNAP_PX)),
      );
      return;
    }
    const hit = hitTest(state.doc, pointer.point, pixels(viewport, HIT_TOLERANCE_PX));
    const flagged = hit && severities.has(hit.id);
    setHover(flagged ? { id: hit.id, screen: pointer.screen } : null);
  };

  const onKey = (event: KeyboardEvent): boolean => {
    if (tool !== 'wall') return false;
    if (event.key === 'Enter') {
      finishWalls(draft);
      return true;
    }
    // Typing a number goes to the length box.
    if (/^[\d.]$/.test(event.key)) lengthInput.current?.focus();
    return false;
  };

  /** Enter in the length box: adds a point that far toward the pointer, or finishes. */
  const submitLength = () => {
    if (lengthText.trim() === '') {
      finishWalls(draft);
      return;
    }
    const last = draft.at(-1);
    if (!last) {
      setLengthError('Click where the wall starts first.');
      return;
    }
    const parsed = parseLength(lengthText);
    if (!parsed.ok) {
      setLengthError(parsed.error.message);
      return;
    }
    if (parsed.value === 0) {
      setLengthError('A wall cannot have zero length.');
      return;
    }
    setLengthText('');
    setLengthError(null);
    addWallPoint(pointAtLength(last, cursor ?? last, parsed.value));
  };

  const ghost = drag ? dragGhost(drag) : null;
  const last = draft.at(-1);
  const stretch = last && cursor ? wallLength({ start: last, end: cursor }) : null;
  const hoverMessages = hover && !drag ? violationsFor(violations, hover.id) : [];

  // The length box sits in its own strip above the canvas, so it never covers a spot the
  // user wants to click.
  const lengthStrip = tool === 'wall' && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-3 py-2 text-xs">
      <label htmlFor="wall-length" className="font-medium text-slate-700">
        Wall length
      </label>
      <input
        id="wall-length"
        ref={lengthInput}
        value={lengthText}
        placeholder={'e.g. 120 or 96 1/2"'}
        autoComplete="off"
        aria-invalid={lengthError !== null}
        aria-describedby="wall-length-help"
        className="w-40 rounded border border-slate-300 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
        onChange={(event) => {
          setLengthText(event.target.value);
          setLengthError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submitLength();
        }}
      />
      <p id="wall-length-help" className="text-slate-600">
        {lengthError ? (
          <span role="alert" className="text-red-700">
            {lengthError}
          </span>
        ) : (
          'Click to add points. Type a length and press Enter to place the next point. Double-click or press Enter to finish.'
        )}
      </p>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {lengthStrip}
      <div className="min-h-0 flex-1">
        <CanvasHost
          label="Plan view of the room. Tab steps through the items, arrow keys move the selected item, Delete removes it."
          onPress={onPress}
          onHover={onHover}
          onDoubleClick={() => {
            if (tool === 'wall') finishWalls(store.getState().wallDraft);
          }}
          onKey={onKey}
          dragPointer={(_drag, point) => point}
          overlay={
            <>
              {doc.room.walls.length === 0 && tool !== 'wall' && (
                <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-slate-500">
                  Start with a room template, or draw walls with the Wall tool.
                </p>
              )}
              {hover && hoverMessages.length > 0 && (
                <ul
                  role="tooltip"
                  className="pointer-events-none absolute z-10 max-w-xs list-disc space-y-1 rounded-md bg-slate-900 py-2 pr-3 pl-6 text-xs text-white shadow-lg"
                  style={{ left: hover.screen.x + 14, top: hover.screen.y + 14 }}
                >
                  {hoverMessages.map((violation, i) => (
                    <li key={i}>{violation.message}</li>
                  ))}
                </ul>
              )}
            </>
          }
        >
          {(size, viewport) => {
            const transform = {
              x: viewport.offsetX,
              y: viewport.offsetY,
              scaleX: viewport.scale / IN,
              scaleY: viewport.scale / IN,
              listening: false,
            };
            return (
              <Stage width={size.width} height={size.height} listening={false}>
                <Layer {...transform}>
                  <GridLayer viewport={viewport} visible={visibleBounds(viewport, size)} />
                  <FloorLayer doc={doc} />
                  <WallsLayer doc={doc} />
                  <OpeningsLayer doc={doc} />
                  <CountertopsLayer doc={doc} />
                  <ItemsLayer
                    doc={doc}
                    severities={severities}
                    viewport={viewport}
                    draggedId={drag && drag.kind !== 'add' ? drag.item.id : undefined}
                  />
                  <DimensionsLayer
                    doc={doc}
                    selected={drag ? undefined : selectedItem}
                    viewport={viewport}
                  />
                </Layer>
                <Layer {...transform}>
                  <GuidesLayer guides={drag?.snap?.guides ?? []} />
                  {!drag && (
                    <SelectionLayer
                      doc={doc}
                      catalog={catalog}
                      selection={selection}
                      handles={tool === 'select'}
                      viewport={viewport}
                    />
                  )}
                  {previewDoc && ghosts && (
                    <ProposalLayer
                      doc={doc}
                      previewDoc={previewDoc}
                      ghosts={ghosts}
                      viewport={viewport}
                    />
                  )}
                  <GhostLayer
                    doc={doc}
                    ghost={ghost}
                    blocked={drag ? dragHasError(drag) : false}
                    viewport={viewport}
                  />
                  {tool === 'wall' && (
                    <WallDraftLayer
                      draft={draft}
                      cursor={cursor}
                      lengthText={stretch ? formatLength(stretch) : null}
                      viewport={viewport}
                    />
                  )}
                </Layer>
              </Stage>
            );
          }}
        </CanvasHost>
      </div>
    </div>
  );
}

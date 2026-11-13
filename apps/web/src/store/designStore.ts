import {
  type Catalog,
  type Command,
  type CommandError,
  type DesignDocument,
  emptyHistory,
  err,
  execute as coreExecute,
  type History,
  type HistoryState,
  type Id,
  ok,
  type Point,
  redo as coreRedo,
  type Result,
  SEED_CATALOG,
  undo as coreUndo,
  validate,
  type Violation,
} from '@ezd/core';
import { immer } from 'zustand/middleware/immer';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { type Drag, dragCommand, type DragUpdate } from '../editor/dragging';
import type { OpeningToolKind } from '../editor/tools/opening';
import { defaultViewport, type Size, type Viewport } from '../editor/viewport';

export type Tool = 'select' | 'wall' | 'opening' | 'pan';

/** A change the assistant proposed, dry-run by core, waiting for the user to accept it. */
export type Proposal = {
  /** The assistant message that proposed it. */
  messageId: string;
  /** One `batch`: accepting it is one undo step. */
  command: Command;
  /** The document as it would be: what the views draw the ghosts from. */
  doc: DesignDocument;
  changes: string[];
  warnings: Violation[];
};
export type View = { kind: 'plan' } | { kind: 'elevation'; wallId: Id };

export type DesignStore = {
  doc: DesignDocument;
  history: History;
  catalog: Catalog;
  /** Recomputed after every executed command, undo and redo. */
  violations: Violation[];
  selection: Id[];
  tool: Tool;
  /** What the opening tool adds. */
  openingKind: OpeningToolKind;
  view: View;
  viewport: Viewport;
  /** The canvas in pixels, so `Fit` and framing work from outside it. Null until measured. */
  canvasSize: Size | null;
  drag: Drag | null;
  /** The points clicked so far with the wall tool. */
  wallDraft: Point[];
  /** A message for the user, such as why core refused a command. */
  notice: string | null;
  /** The assistant's pending proposal. Any change to the document cancels it. */
  proposal: Proposal | null;

  execute(cmd: Command): Result<void, CommandError>;
  undo(): void;
  redo(): void;
  select(ids: Id[]): void;
  setTool(tool: Tool): void;
  setOpeningKind(kind: OpeningToolKind): void;
  setView(view: View): void;
  setViewport(viewport: Viewport): void;
  setCanvasSize(size: Size): void;
  setWallDraft(points: Point[]): void;
  startDrag(drag: Drag): void;
  /** Called on each pointer move. */
  updateDrag(update: DragUpdate): void;
  /** The drop: executes exactly one command, or none if the ghost is outside the canvas. */
  commitDrag(): void;
  cancelDrag(): void;
  notify(notice: string | null): void;
  /** Shows a proposal, or drops the pending one without changing the document. */
  propose(proposal: Proposal | null): void;
  /** Executes the pending proposal's command. */
  acceptProposal(): Result<void, CommandError>;
};

export type DesignStoreApi = StoreApi<DesignStore>;

const entityIds = (doc: DesignDocument): Set<Id> =>
  new Set(
    [doc.room.walls, doc.room.openings, doc.items, doc.countertops].flatMap((list) =>
      list.map((entity) => entity.id),
    ),
  );

/**
 * The editor's state for one design. A design that is loaded or imported gets a new
 * store: inside a store, `execute`, `undo` and `redo` are the only places that replace
 * `doc`, each with the document core returned. ESLint rejects an assignment to `doc`
 * anywhere else. Immer handles the UI state only.
 */
export function createDesignStore(
  doc: DesignDocument,
  catalog: Catalog = SEED_CATALOG,
): DesignStoreApi {
  return createStore<DesignStore>()(
    immer((set, get) => {
      /** Takes the state core returned and drops what no longer refers to anything. */
      const replace = (next: HistoryState) =>
        set((state) => {
          state.doc = next.doc;
          state.history = next.history;
          state.violations = validate(next.doc, catalog);
          const ids = entityIds(next.doc);
          state.selection = state.selection.filter((id) => ids.has(id));
          if (state.view.kind === 'elevation' && !ids.has(state.view.wallId)) {
            state.view = { kind: 'plan' };
          }
          // A proposal was dry-run against the document before this change.
          state.proposal = null;
        });

      return {
        doc,
        history: emptyHistory(),
        catalog,
        violations: validate(doc, catalog),
        selection: [],
        tool: 'select',
        openingKind: 'door',
        view: { kind: 'plan' },
        viewport: defaultViewport(),
        canvasSize: null,
        drag: null,
        wallDraft: [],
        notice: null,
        proposal: null,

        execute(cmd) {
          const { doc: current, history } = get();
          const executed = coreExecute({ doc: current, history }, cmd, { catalog });
          if (!executed.ok) return executed;
          replace(executed.value);
          return ok(undefined);
        },
        undo() {
          const { doc: current, history } = get();
          replace(coreUndo({ doc: current, history }));
        },
        redo() {
          const { doc: current, history } = get();
          replace(coreRedo({ doc: current, history }));
        },

        select: (ids) =>
          set((state) => {
            state.selection = ids;
          }),
        setTool: (tool) =>
          set((state) => {
            state.tool = tool;
            state.drag = null;
            state.wallDraft = [];
          }),
        setOpeningKind: (kind) =>
          set((state) => {
            state.openingKind = kind;
          }),
        setView: (view) =>
          set((state) => {
            state.view = view;
            state.drag = null;
            state.wallDraft = [];
          }),
        setViewport: (viewport) =>
          set((state) => {
            state.viewport = viewport;
          }),
        setCanvasSize: (size) =>
          set((state) => {
            state.canvasSize = size;
          }),

        setWallDraft: (points) =>
          set((state) => {
            state.wallDraft = points;
          }),

        startDrag: (drag) =>
          set((state) => {
            state.drag = drag;
          }),
        updateDrag: (update) =>
          set((state) => {
            if (!state.drag) return;
            state.drag.snap = update.snap;
            if (state.drag.kind === 'resize' && update.width !== undefined) {
              state.drag.width = update.width;
            }
          }),
        commitDrag() {
          const { drag } = get();
          if (!drag) return;
          set((state) => {
            state.drag = null;
          });
          const command = dragCommand(catalog, drag);
          if (!command) return;
          const executed = get().execute(command);
          if (executed.ok) get().select([drag.item.id]);
          else get().notify(executed.error.message);
        },
        cancelDrag: () =>
          set((state) => {
            state.drag = null;
          }),
        notify: (notice) =>
          set((state) => {
            state.notice = notice;
          }),
        propose: (proposal) =>
          set((state) => {
            state.proposal = proposal;
          }),
        acceptProposal() {
          const { proposal } = get();
          if (!proposal)
            return err({ code: 'NOT_FOUND', message: 'There is no proposal to accept.' });
          return get().execute(proposal.command);
        },
      };
    }),
  );
}

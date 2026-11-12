import {
  applyCommand,
  type Command,
  type CommandContext,
  type CommandError,
} from '../commands/index.js';
import type { DesignDocument } from '../document/index.js';
import { ok, type Result } from '../result.js';

/** A command that was applied and the command that undoes it. */
export type Entry = { command: Command; inverse: Command };
/** `past` is oldest first. `future` holds undone entries, next to redo last. */
export type History = { past: Entry[]; future: Entry[] };
export type HistoryState = { doc: DesignDocument; history: History };

/** Undo depth. Older entries are dropped. */
export const HISTORY_LIMIT = 200;

export const emptyHistory = (): History => ({ past: [], future: [] });

/**
 * Applies a command and records it as one undo step. Clears the redo stack. `context` is
 * passed to `applyCommand`; undo and redo replay recorded commands without it.
 */
export function execute(
  state: HistoryState,
  cmd: Command,
  context?: CommandContext,
): Result<HistoryState, CommandError> {
  const applied = applyCommand(state.doc, cmd, context);
  if (!applied.ok) return applied;
  const entry: Entry = { command: cmd, inverse: applied.value.inverse };
  return ok({
    doc: applied.value.doc,
    history: { past: [...state.history.past, entry].slice(-HISTORY_LIMIT), future: [] },
  });
}

/** Undoes the last step. Returns the same state when there is nothing to undo. */
export function undo(state: HistoryState): HistoryState {
  const { past, future } = state.history;
  const entry = past.at(-1);
  if (!entry) return state;
  const applied = applyCommand(state.doc, entry.inverse);
  // An inverse recorded by `execute` always applies. A hand-built history may not.
  if (!applied.ok) return state;
  return {
    doc: applied.value.doc,
    history: { past: past.slice(0, -1), future: [...future, entry] },
  };
}

/** Redoes the last undone step. Returns the same state when there is nothing to redo. */
export function redo(state: HistoryState): HistoryState {
  const { past, future } = state.history;
  const entry = future.at(-1);
  if (!entry) return state;
  const applied = applyCommand(state.doc, entry.command);
  if (!applied.ok) return state;
  return {
    doc: applied.value.doc,
    history: { past: [...past, entry], future: future.slice(0, -1) },
  };
}

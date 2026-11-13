import type { AppConfig } from '@ezd/core';

import { duplicateCommand, isArrowKey, nudgeCommand, removeCommand } from '../editor/edits';
import { newId } from '../editor/ids';
import { findTarget, nextInTabOrder } from '../editor/tools/select';
import type { DesignStoreApi } from '../store/designStore';

// Keyboard shortcuts. Each returns whether it handled the key, so the caller can stop the
// browser's own handling.

type Key = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/** Whether the key press is going into a text field, which keeps its own editing keys. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Removes the selection. Shows core's reason when it refuses, as for a wall with items. */
export function deleteSelection(store: DesignStoreApi): void {
  const { doc, selection, execute, notify } = store.getState();
  const command = removeCommand(doc, selection);
  if (!command) return;
  const executed = execute(command);
  notify(executed.ok ? null : executed.error.message);
}

export function duplicateSelection(store: DesignStoreApi): void {
  const { doc, selection, execute, select, notify } = store.getState();
  const [id] = selection;
  const target = selection.length === 1 && id ? findTarget(doc, id) : null;
  if (target?.kind !== 'item') return;
  const command = duplicateCommand(doc, target.item, newId);
  if (!command || command.type !== 'item.add') {
    notify('There is no free space on this wall for a copy.');
    return;
  }
  const executed = execute(command);
  if (executed.ok) select([command.item.id]);
  notify(executed.ok ? null : executed.error.message);
}

/** Shortcuts that work wherever the focus is, outside text fields. */
export function handleGlobalKey(
  event: Key,
  store: DesignStoreApi,
  /** Undo and redo keys go with the Undo and Redo buttons when the toolbar hides them. */
  buttons: Pick<AppConfig['toolbar']['buttons'], 'undoRedo'> = { undoRedo: true },
): boolean {
  const state = store.getState();
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (event.key === 'Escape') {
    const active = state.drag !== null || state.tool !== 'select';
    // `setTool` also drops the drag in progress.
    state.setTool('select');
    return active;
  }
  if (mod && key === 'z' && buttons.undoRedo) {
    if (event.shiftKey) state.redo();
    else state.undo();
    return true;
  }
  if (mod && key === 'y' && buttons.undoRedo) {
    state.redo();
    return true;
  }
  if (mod && key === 'd') {
    duplicateSelection(store);
    return true;
  }
  if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
    if (state.selection.length === 0) return false;
    deleteSelection(store);
    return true;
  }
  return false;
}

/**
 * Keys for the focused canvas: arrows nudge the selected item, and Tab steps through the
 * items in wall order. Tab past the last item is not handled, so focus leaves the canvas.
 */
export function handleCanvasKey(event: Key, store: DesignStoreApi): boolean {
  const state = store.getState();
  if (event.ctrlKey || event.metaKey || event.altKey) return false;

  if (event.key === 'Tab') {
    const next = nextInTabOrder(state.doc, state.selection[0], event.shiftKey);
    if (next === null) {
      state.select([]);
      return false;
    }
    state.select([next]);
    return true;
  }
  if (isArrowKey(event.key)) {
    const [id] = state.selection;
    const target = state.selection.length === 1 && id ? findTarget(state.doc, id) : null;
    if (target?.kind !== 'item') return false;
    const command = nudgeCommand(
      state.doc,
      target.item,
      event.key,
      event.shiftKey,
      state.view.kind,
    );
    if (command) state.execute(command);
    return true;
  }
  return false;
}

import { inches } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { room, seedItem, storeFor, WALLS } from '../test/kitchen';
import { handleCanvasKey, handleGlobalKey, isTyping } from './shortcuts';

const [A, B] = WALLS;
const key = (
  name: string,
  modifiers: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey', boolean>> = {},
) => ({
  key: name,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

const kitchen = () =>
  storeFor(
    room(
      144,
      120,
      seedItem('item-000001', 'base.standard', A, 12),
      seedItem('item-000002', 'filler.base', A, 42),
      seedItem('item-000003', 'base.sink', B, 36),
    ),
  );
const offsetOf = (store: ReturnType<typeof storeFor>, id: string) => {
  const item = store.getState().doc.items.find((candidate) => candidate.id === id)!;
  return item.placement.type === 'wall' ? item.placement.offset : NaN;
};

describe('the keyboard path on the canvas', () => {
  it('cycles through the items in wall order with Tab', () => {
    const store = kitchen();
    const visited: string[] = [];
    while (handleCanvasKey(key('Tab'), store)) visited.push(store.getState().selection[0]!);
    expect(visited).toEqual(['item-000001', 'item-000002', 'item-000003']);
    // Past the last item Tab is left to the browser, so focus moves on.
    expect(store.getState().selection).toEqual([]);

    expect(handleCanvasKey(key('Tab', { shiftKey: true }), store)).toBe(true);
    expect(store.getState().selection).toEqual(['item-000003']);
  });

  it('nudges the selected item 3 in with the arrows, as one command each', () => {
    const store = kitchen();
    store.getState().select(['item-000001']);
    expect(handleCanvasKey(key('ArrowRight'), store)).toBe(true);
    expect(handleCanvasKey(key('ArrowRight', { shiftKey: true }), store)).toBe(true);
    expect(offsetOf(store, 'item-000001')).toBe(inches(18));
    expect(store.getState().history.past).toHaveLength(2);
    handleCanvasKey(key('ArrowLeft'), store);
    expect(offsetOf(store, 'item-000001')).toBe(inches(15));
  });

  it('nudges a filler 1/16 in with Shift', () => {
    const store = kitchen();
    store.getState().select(['item-000002']);
    handleCanvasKey(key('ArrowRight', { shiftKey: true }), store);
    expect(offsetOf(store, 'item-000002')).toBe(inches(42) + 1);
  });

  it('leaves the arrows alone when no item is selected', () => {
    const store = kitchen();
    expect(handleCanvasKey(key('ArrowRight'), store)).toBe(false);
    store.getState().select([A]);
    expect(handleCanvasKey(key('ArrowRight'), store)).toBe(false);
    expect(store.getState().history.past).toHaveLength(0);
  });
});

describe('global shortcuts', () => {
  it('undoes and redoes', () => {
    const store = kitchen();
    store.getState().select(['item-000001']);
    handleCanvasKey(key('ArrowRight'), store);
    expect(handleGlobalKey(key('z', { ctrlKey: true }), store)).toBe(true);
    expect(offsetOf(store, 'item-000001')).toBe(inches(12));
    expect(handleGlobalKey(key('Z', { metaKey: true, shiftKey: true }), store)).toBe(true);
    expect(offsetOf(store, 'item-000001')).toBe(inches(15));
    handleGlobalKey(key('z', { ctrlKey: true }), store);
    handleGlobalKey(key('y', { ctrlKey: true }), store);
    expect(offsetOf(store, 'item-000001')).toBe(inches(15));
  });

  it('removes the selection with Delete or Backspace', () => {
    const store = kitchen();
    expect(handleGlobalKey(key('Delete'), store)).toBe(false);
    store.getState().select(['item-000001']);
    expect(handleGlobalKey(key('Delete'), store)).toBe(true);
    store.getState().select(['item-000002']);
    expect(handleGlobalKey(key('Backspace'), store)).toBe(true);
    expect(store.getState().doc.items.map((item) => item.id)).toEqual(['item-000003']);
    expect(store.getState().history.past.map((entry) => entry.command.type)).toEqual([
      'item.remove',
      'item.remove',
    ]);
  });

  it("shows core's error when a wall with items is deleted", () => {
    const store = kitchen();
    store.getState().select([A]);
    handleGlobalKey(key('Delete'), store);
    expect(store.getState().doc.room.walls).toHaveLength(4);
    expect(store.getState().notice).toMatch(/has 2 item\(s\) placed on it/);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('duplicates the selected item to the next free position and selects the copy', () => {
    const store = kitchen();
    store.getState().select(['item-000001']);
    expect(handleGlobalKey(key('d', { ctrlKey: true }), store)).toBe(true);
    const { doc, selection, history } = store.getState();
    expect(doc.items).toHaveLength(4);
    expect(history.past).toHaveLength(1);
    const copy = doc.items[3]!;
    expect(selection).toEqual([copy.id]);
    // After the filler, which ends 45 in along the wall.
    expect(copy).toMatchObject({
      catalogId: 'base.standard',
      placement: { type: 'wall', wallId: A, offset: inches(45) },
    });
  });

  it('cancels the drag and the tool with Escape', () => {
    const store = kitchen();
    const item = store.getState().doc.items[0]!;
    store.getState().setTool('wall');
    store.getState().setWallDraft([{ x: 0, y: 0 }]);
    store.getState().startDrag({ kind: 'add', item: { ...item, id: 'item-000009' }, snap: null });

    expect(handleGlobalKey(key('Escape'), store)).toBe(true);
    expect(store.getState()).toMatchObject({ drag: null, tool: 'select', wallDraft: [] });
    expect(store.getState().history.past).toHaveLength(0);
    expect(handleGlobalKey(key('Escape'), store)).toBe(false);
  });
});

it('knows when a key press is going into a text field', () => {
  const input = document.createElement('input');
  const select = document.createElement('select');
  const button = document.createElement('button');
  expect(isTyping(input)).toBe(true);
  expect(isTyping(select)).toBe(true);
  expect(isTyping(button)).toBe(false);
  expect(isTyping(null)).toBe(false);
});

import { applyCommand, type Command, inches, type Point, SEED_CATALOG, validate } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { type Drag, snapDrag } from '../editor/dragging';
import { room, seedItem, storeFor, WALLS } from '../test/kitchen';

const [A, B] = WALLS;
const base = (id: string, offset: number) => seedItem(id, 'base.standard', A, offset);
const add = (id: string, offset: number): Command => ({ type: 'item.add', item: base(id, offset) });

/** A pointer in plan, in inches. */
const at = (x: number, y: number): Point => ({ x: inches(x), y: inches(y) });

describe('execute', () => {
  it('updates doc, history and violations', () => {
    const store = storeFor(room());
    const before = store.getState().doc;

    const result = store.getState().execute(add('item-000001', 12));

    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.doc).not.toBe(before);
    expect(state.doc.items.map((item) => item.id)).toEqual(['item-000001']);
    expect(state.history.past).toHaveLength(1);
    expect(state.history.future).toEqual([]);
    expect(state.violations).toEqual(validate(state.doc, SEED_CATALOG));
    expect(state.violations.length).toBeGreaterThan(0);
  });

  it('recomputes violations after every command', () => {
    const store = storeFor(room());
    store.getState().execute(add('item-000001', 12));
    store.getState().execute(add('item-000002', 24));
    const overlap = () => store.getState().violations.filter((v) => v.ruleId === 'item.overlap');
    expect(overlap()).toHaveLength(1);

    store.getState().execute({
      type: 'item.move',
      id: 'item-000002',
      placement: { type: 'wall', wallId: A, offset: inches(42) },
    });
    expect(overlap()).toHaveLength(0);
  });

  it('returns the error and changes nothing when core refuses the command', () => {
    const store = storeFor(room());
    const before = store.getState();

    const result = store
      .getState()
      .execute({ type: 'item.add', item: { ...base('item-000001', 12), width: inches(31) } });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('Width 31" is not allowed');
    expect(store.getState().doc).toBe(before.doc);
    expect(store.getState().history).toBe(before.history);
  });

  it('drops a selection and a view that no longer refer to anything', () => {
    const store = storeFor(room());
    store.getState().execute(add('item-000001', 12));
    store.getState().select(['item-000001']);
    store.getState().undo();
    expect(store.getState().selection).toEqual([]);

    const walls = store.getState().doc.room.walls;
    store.getState().setView({ kind: 'elevation', wallId: B });
    store.getState().execute({ type: 'wall.remove', id: B });
    expect(store.getState().doc.room.walls).toHaveLength(walls.length - 1);
    expect(store.getState().view).toEqual({ kind: 'plan' });
  });
});

describe('undo and redo', () => {
  it('restore the exact documents', () => {
    const store = storeFor(room());
    const docs = [store.getState().doc];
    const commands: Command[] = [
      add('item-000001', 12),
      add('item-000002', 42),
      { type: 'item.resize', id: 'item-000001', width: inches(24) },
      {
        type: 'batch',
        commands: [
          { type: 'item.resize', id: 'item-000002', width: inches(36) },
          {
            type: 'item.move',
            id: 'item-000002',
            placement: { type: 'wall', wallId: A, offset: inches(36) },
          },
        ],
      },
    ];
    for (const command of commands) {
      expect(store.getState().execute(command).ok).toBe(true);
      docs.push(store.getState().doc);
    }
    expect(store.getState().history.past).toHaveLength(commands.length);

    for (let i = docs.length - 2; i >= 0; i -= 1) {
      store.getState().undo();
      expect(store.getState().doc).toEqual(docs[i]);
      expect(store.getState().violations).toEqual(validate(docs[i]!, SEED_CATALOG));
    }
    expect(store.getState().history.past).toHaveLength(0);

    for (let i = 1; i < docs.length; i += 1) {
      store.getState().redo();
      expect(store.getState().doc).toEqual(docs[i]);
    }
    expect(store.getState().history.future).toHaveLength(0);
  });

  it('do nothing when there is nothing to undo or redo', () => {
    const store = storeFor(room());
    const { doc } = store.getState();
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().doc).toEqual(doc);
    expect(store.getState().history).toEqual({ past: [], future: [] });
  });
});

describe('dragging', () => {
  /** Starts a drag and moves it to each pointer, as the canvas does on pointer moves. */
  function dragThrough(store: ReturnType<typeof storeFor>, drag: Drag, pointers: Point[]) {
    store.getState().startDrag(drag);
    for (const pointer of pointers) {
      const { doc, catalog, drag: current } = store.getState();
      store.getState().updateDrag(snapDrag(doc, catalog, current!, pointer));
    }
  }
  const adding = (): Drag => ({ kind: 'add', item: base('item-000009', 0), snap: null });

  it('updates the ghost on each move and executes exactly one command on the drop', () => {
    const store = storeFor(room());
    dragThrough(store, adding(), [at(30, 20), at(40, 10), at(63, 6)]);

    // Nothing is in the document while the ghost moves.
    expect(store.getState().doc.items).toEqual([]);
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().drag?.snap?.placement).toEqual({
      type: 'wall',
      wallId: A,
      offset: inches(48),
    });

    store.getState().commitDrag();

    const state = store.getState();
    expect(state.drag).toBeNull();
    expect(state.history.past).toHaveLength(1);
    expect(state.history.past[0]!.command.type).toBe('item.add');
    expect(state.doc.items).toHaveLength(1);
    expect(state.doc.items[0]!.placement).toEqual({ type: 'wall', wallId: A, offset: inches(48) });
    expect(state.selection).toEqual(['item-000009']);
  });

  it('executes nothing when the drag is cancelled', () => {
    const store = storeFor(room());
    const { doc } = store.getState();
    dragThrough(store, adding(), [at(40, 10)]);

    store.getState().cancelDrag();

    expect(store.getState().drag).toBeNull();
    expect(store.getState().doc).toBe(doc);
    expect(store.getState().history.past).toHaveLength(0);
    // The drop that follows a cancel has nothing to commit.
    store.getState().commitDrag();
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('executes nothing when the item is dropped outside the canvas', () => {
    const store = storeFor(room());
    dragThrough(store, adding(), [at(40, 10)]);
    store.getState().updateDrag({ snap: null });

    store.getState().commitDrag();

    expect(store.getState().drag).toBeNull();
    expect(store.getState().doc.items).toEqual([]);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('cancels the drag when the tool or the view changes', () => {
    const store = storeFor(room());
    dragThrough(store, adding(), [at(40, 10)]);
    store.getState().setTool('select');
    expect(store.getState().drag).toBeNull();
  });

  it('moves an item with one item.move, and not at all if it is dropped where it was', () => {
    const store = storeFor(room(144, 120, base('item-000001', 12)));
    const item = store.getState().doc.items[0]!;
    const moving = (): Drag => ({ kind: 'move', item, grab: { x: 0, y: 0 }, snap: null });

    dragThrough(store, moving(), [at(27, 0)]);
    store.getState().commitDrag();
    expect(store.getState().history.past).toHaveLength(0);

    dragThrough(store, moving(), [at(40, 0), at(75, 0)]);
    store.getState().commitDrag();
    expect(store.getState().history.past.map((entry) => entry.command.type)).toEqual(['item.move']);
    expect(store.getState().doc.items[0]!.placement).toEqual({
      type: 'wall',
      wallId: A,
      offset: inches(60),
    });
  });

  it('shows a ghost that reports the errors a drop would introduce', () => {
    const store = storeFor(room(144, 120, base('item-000001', 12)));
    dragThrough(store, adding(), [at(36, 6)]);
    const introduced = store.getState().drag!.snap!.introduced;
    expect(introduced.some((v) => v.ruleId === 'item.overlap' && v.severity === 'error')).toBe(
      true,
    );

    // Dropping with errors is allowed; the violation then shows in the panel.
    store.getState().commitDrag();
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().violations.some((v) => v.ruleId === 'item.overlap')).toBe(true);
  });

  it('resizes from the right with one item.resize, in 3 in steps', () => {
    const store = storeFor(room(144, 120, base('item-000001', 12)));
    const item = store.getState().doc.items[0]!;
    dragThrough(store, { kind: 'resize', item, edge: 'right', width: item.width, snap: null }, [
      at(47, 12),
    ]);
    expect(store.getState().drag).toMatchObject({ kind: 'resize', width: inches(36) });

    store.getState().commitDrag();
    expect(store.getState().history.past.map((entry) => entry.command.type)).toEqual([
      'item.resize',
    ]);
    expect(store.getState().doc.items[0]).toMatchObject({ width: inches(36) });
  });

  it('resizes from the left with one batch that also moves the item', () => {
    const store = storeFor(room(144, 120, base('item-000001', 12)));
    const item = store.getState().doc.items[0]!;
    dragThrough(store, { kind: 'resize', item, edge: 'left', width: item.width, snap: null }, [
      at(5.5, 12),
    ]);
    store.getState().commitDrag();

    const { history, doc } = store.getState();
    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.command).toMatchObject({
      type: 'batch',
      commands: [{ type: 'item.resize' }, { type: 'item.move' }],
    });
    expect(doc.items[0]).toMatchObject({
      width: inches(36),
      placement: { type: 'wall', wallId: A, offset: inches(6) },
    });
    store.getState().undo();
    expect(store.getState().doc.items[0]).toEqual(item);
  });
});

describe('proposals', () => {
  const proposalFor = (store: ReturnType<typeof storeFor>) => {
    const command: Command = {
      type: 'batch',
      label: 'Assistant edit',
      commands: [add('item-000001', 12), add('item-000002', 48)],
    };
    const executed = applyCommand(store.getState().doc, command, { catalog: SEED_CATALOG });
    if (!executed.ok) throw new Error(executed.error.message);
    return { messageId: 'msg-1', command, doc: executed.value.doc, changes: [], warnings: [] };
  };

  it('accepting is one history entry, and one undo restores the document', () => {
    const store = storeFor(room());
    const before = store.getState().doc;
    store.getState().propose(proposalFor(store));
    expect(store.getState().doc).toBe(before);

    expect(store.getState().acceptProposal().ok).toBe(true);
    expect(store.getState().doc.items).toHaveLength(2);
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().proposal).toBeNull();

    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
  });

  it('rejecting leaves the document as it was', () => {
    const store = storeFor(room());
    const before = store.getState().doc;
    store.getState().propose(proposalFor(store));
    store.getState().propose(null);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().acceptProposal().ok).toBe(false);
  });

  it('a manual edit cancels a pending proposal', () => {
    const store = storeFor(room());
    store.getState().propose(proposalFor(store));
    store.getState().execute(add('item-000009', 96));
    expect(store.getState().proposal).toBeNull();
  });
});

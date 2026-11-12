import { describe, expect, it } from 'vitest';

import { SEED_CATALOG } from '../catalog/index.js';
import type { Command } from '../commands/index.js';
import { sampleDocument } from '../test/fixtures.js';
import { inches } from '../units/index.js';
import { emptyHistory, execute, HISTORY_LIMIT, type HistoryState, redo, undo } from './index.js';

const start = (): HistoryState => ({ doc: sampleDocument(), history: emptyHistory() });

function run(state: HistoryState, cmd: Command): HistoryState {
  const result = execute(state, cmd);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const rename = (name: string): Command => ({ type: 'document.rename', name });

describe('history', () => {
  it('execute applies the command and records it with its inverse', () => {
    const state = run(start(), rename('One'));
    expect(state.doc.name).toBe('One');
    expect(state.history).toEqual({
      past: [{ command: rename('One'), inverse: rename('Sample kitchen') }],
      future: [],
    });
  });

  it('execute returns the error and records nothing when the command fails', () => {
    const result = execute(start(), { type: 'item.remove', id: 'item-missing' });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('execute checks the command against the catalog when given one', () => {
    const resize: Command = { type: 'item.resize', id: 'item-base-01', width: inches(31) };
    expect(execute(start(), resize).ok).toBe(true);
    expect(execute(start(), resize, { catalog: SEED_CATALOG })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', constraintErrors: [{ code: 'UNKNOWN_CATALOG_ID' }] },
    });
  });

  it('undo and redo walk back and forth through the steps', () => {
    const initial = start();
    const one = run(initial, rename('One'));
    const two = run(one, { type: 'room.setCeilingHeight', height: inches(108) });

    const backOne = undo(two);
    expect(backOne.doc).toStrictEqual(one.doc);
    expect(backOne.history.past).toHaveLength(1);
    expect(backOne.history.future).toHaveLength(1);

    const backTwo = undo(backOne);
    expect(backTwo.doc).toStrictEqual(initial.doc);
    expect(backTwo.history.past).toEqual([]);
    expect(backTwo.history.future).toHaveLength(2);

    const forwardOne = redo(backTwo);
    expect(forwardOne.doc).toStrictEqual(one.doc);
    const forwardTwo = redo(forwardOne);
    expect(forwardTwo.doc).toStrictEqual(two.doc);
    expect(forwardTwo.history).toEqual(two.history);
  });

  it('undo and redo are no-ops at the ends', () => {
    const initial = start();
    expect(undo(initial)).toBe(initial);
    expect(redo(initial)).toBe(initial);
    const one = run(initial, rename('One'));
    expect(redo(one)).toBe(one);
  });

  it('execute clears the redo stack', () => {
    const undone = undo(run(run(start(), rename('One')), rename('Two')));
    expect(undone.history.future).toHaveLength(1);
    const branched = run(undone, rename('Three'));
    expect(branched.history.future).toEqual([]);
    expect(branched.history.past.map((entry) => entry.command)).toEqual([
      rename('One'),
      rename('Three'),
    ]);
    expect(redo(branched)).toBe(branched);
  });

  it(`keeps the last ${HISTORY_LIMIT} steps and drops the oldest`, () => {
    expect(HISTORY_LIMIT).toBe(200);
    let state = start();
    for (let i = 1; i <= HISTORY_LIMIT + 5; i += 1) state = run(state, rename(`Name ${i}`));
    expect(state.history.past).toHaveLength(HISTORY_LIMIT);
    expect(state.history.past[0]!.command).toEqual(rename('Name 6'));

    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) state = undo(state);
    // The five oldest steps can no longer be undone.
    expect(state.doc.name).toBe('Name 5');
    expect(state.history.past).toEqual([]);
    expect(state.history.future).toHaveLength(HISTORY_LIMIT);
  });

  it('treats a batch as one step', () => {
    const initial = start();
    const state = run(initial, {
      type: 'batch',
      label: 'Clear the north wall',
      commands: [
        { type: 'item.remove', id: 'item-base-01' },
        { type: 'item.remove', id: 'item-wall-01' },
        { type: 'wall.remove', id: 'wall-north' },
      ],
    });
    expect(state.history.past).toHaveLength(1);
    expect(state.doc.items).toHaveLength(2);

    const undone = undo(state);
    expect(undone.doc).toStrictEqual(initial.doc);
    expect(redo(undone).doc).toStrictEqual(state.doc);
  });

  it('leaves the state alone when a hand-built entry does not apply', () => {
    const broken = { command: rename('One'), inverse: { type: 'item.remove', id: 'item-missing' } };
    const brokenRedo = { command: broken.inverse, inverse: rename('One') };
    const past: HistoryState = {
      doc: sampleDocument(),
      history: { past: [broken as never], future: [] },
    };
    expect(undo(past)).toBe(past);
    const future: HistoryState = {
      doc: sampleDocument(),
      history: { past: [], future: [brokenRedo as never] },
    };
    expect(redo(future)).toBe(future);
  });
});

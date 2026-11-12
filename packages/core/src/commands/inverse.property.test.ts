import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseDocument } from '../document/index.js';
import { documentAndCommandArb, documentArb } from '../test/arbitraries.js';
import { deepFreeze } from '../test/fixtures.js';
import { applyCommand, type CommandType } from './index.js';

describe('applyCommand properties', () => {
  it('the generator produces valid documents', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        expect(parseDocument(doc)).toEqual({ ok: true, value: doc });
      }),
    );
  });

  it('apply then inverse restores the document, without mutating anything', () => {
    const seen = new Set<CommandType>();
    fc.assert(
      fc.property(documentAndCommandArb, ({ doc, cmd }) => {
        deepFreeze(doc);
        deepFreeze(cmd);
        seen.add(cmd.type);

        const applied = applyCommand(doc, cmd);
        if (!applied.ok) throw new Error(applied.error.message);
        // The result is still a valid document.
        expect(parseDocument(applied.value.doc)).toEqual({ ok: true, value: applied.value.doc });

        deepFreeze(applied.value);
        const undone = applyCommand(applied.value.doc, applied.value.inverse);
        if (!undone.ok) throw new Error(undone.error.message);
        expect(undone.value.doc).toStrictEqual(doc);

        // The inverse of the inverse redoes the command.
        const redone = applyCommand(undone.value.doc, undone.value.inverse);
        if (!redone.ok) throw new Error(redone.error.message);
        expect(redone.value.doc).toStrictEqual(applied.value.doc);
      }),
      { numRuns: 1500 },
    );
    // The run exercised every command type.
    expect(seen.size).toBe(14);
  });
});

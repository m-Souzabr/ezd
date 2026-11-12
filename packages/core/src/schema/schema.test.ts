import { describe, expect, it } from 'vitest';

import { COMMAND_TYPES } from '../commands/index.js';
import { commandsJsonSchema, designDocumentJsonSchema } from './index.js';

type Node = Record<string, unknown>;

/** Every schema node in the tree that describes a number. */
function numberNodes(node: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(node)) node.forEach((child) => numberNodes(child, found));
  else if (typeof node === 'object' && node !== null) {
    const schema = node as Node;
    if (schema.type === 'number' || schema.type === 'integer') found.push(schema);
    Object.values(schema).forEach((child) => numberNodes(child, found));
  }
  return found;
}

describe('JSON Schema export', () => {
  it('describes the design document', () => {
    const schema = designDocumentJsonSchema();
    expect(schema).toMatchObject({
      title: 'EZDesign Design Document',
      type: 'object',
      required: ['schemaVersion', 'id', 'name', 'room', 'items'],
      additionalProperties: false,
    });
    expect(Object.keys(schema.$defs as Node).sort()).toEqual([
      'Item',
      'Opening',
      'Placement',
      'Point',
      'Wall',
    ]);
  });

  it('describes every command', () => {
    const schema = commandsJsonSchema();
    const command = (schema.$defs as Record<string, { oneOf: Node[] }>).Command!;
    const types = command.oneOf.map(
      (option) => (option.properties as { type: { const: string } }).type.const,
    );
    expect(types).toEqual(COMMAND_TYPES);
  });

  it('types every number in the document as an integer', () => {
    const numbers = numberNodes(designDocumentJsonSchema());
    expect(numbers.length).toBeGreaterThan(10);
    // Option values are the one place a document holds a free-form number.
    const floats = numbers.filter((node) => node.type !== 'integer');
    expect(floats).toHaveLength(1);
  });
});

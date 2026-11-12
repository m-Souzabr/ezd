import { describe, expect, it } from 'vitest';

import { describeIssues, issuePath } from './issues.js';

describe('issuePath', () => {
  it('writes keys with dots and indexes with brackets', () => {
    expect(issuePath(['room', 'walls', 0, 'end'])).toBe('room.walls[0].end');
    expect(issuePath([0, 'id'])).toBe('[0].id');
    expect(issuePath([])).toBe('');
  });
});

describe('describeIssues', () => {
  it('joins issues and leaves out an empty path', () => {
    expect(
      describeIssues([
        { path: 'items[1].id', message: 'Duplicate id' },
        { path: '', message: 'Expected object' },
      ]),
    ).toBe('items[1].id: Duplicate id; Expected object');
  });
});

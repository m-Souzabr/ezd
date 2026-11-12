import type { Id } from '@ezd/core';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_LENGTH = 10;

/** A new entity id such as `item-k3j2h4g5x0`. Commands carry the ids of what they add. */
export function newId(prefix: string): Id {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
  const random = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${prefix}-${random}`;
}

export type NewId = typeof newId;

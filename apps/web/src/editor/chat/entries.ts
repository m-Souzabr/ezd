import type { ChatMessage } from '../../api/client';
import type { Outcome } from './assistant';

// What the chat panel lists: the stored conversation, then the answers of this session.

export type Entry = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** For a proposal: the change list, and what became of it. */
  changes?: string[];
  status?: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'failed';
};

export const STATUS_TEXT: Record<NonNullable<Entry['status']>, string> = {
  pending: 'Waiting for you to accept or reject',
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled: the design was changed by hand',
  failed: 'Not applied',
};

/** The stored conversation as chat entries: each user message and its last attempt. */
export function historyEntries(messages: readonly ChatMessage[]): Entry[] {
  const last = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (message.role === 'assistant' && message.parent) {
      const seen = last.get(message.parent);
      if (!seen || seen.attempt < message.attempt) last.set(message.parent, message);
    }
  }
  return messages.flatMap((message): Entry[] => {
    if (message.role === 'user') return [{ id: message.id, role: 'user', text: message.text }];
    if (!message.parent || last.get(message.parent) !== message) return [];
    const proposed = message.tool_calls.length > 0;
    const status =
      message.status === 'accepted' || message.status === 'rejected'
        ? message.status
        : message.status === 'invalid' || (proposed && message.status === 'proposed')
          ? 'failed'
          : undefined;
    return [
      {
        id: message.id,
        role: 'assistant',
        text: message.question || message.text || (proposed ? 'Proposed a change.' : ''),
        ...(status && { status }),
      },
    ];
  });
}

/** What the chat shows for an answer. */
export function outcomeEntry(outcome: Outcome): Entry {
  const { messageId: id } = outcome;
  switch (outcome.kind) {
    case 'proposal':
      return {
        id,
        role: 'assistant',
        text: outcome.text || 'Here is what I would change:',
        changes: outcome.changes,
        status: 'pending',
      };
    case 'question':
    case 'text':
      return { id, role: 'assistant', text: outcome.text };
    case 'failed':
      return {
        id,
        role: 'assistant',
        text:
          (outcome.text ? `${outcome.text}\n\n` : '') +
          `I could not find a change that the design rules accept:\n${outcome.reasons
            .map((reason) => `• ${reason}`)
            .join('\n')}`,
        status: 'failed',
      };
    case 'stale':
      return {
        id,
        role: 'assistant',
        text: 'The design changed while I was working, so I dropped my answer. Ask again.',
      };
  }
}

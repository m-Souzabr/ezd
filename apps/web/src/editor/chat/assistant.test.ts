import { describe, expect, it, vi } from 'vitest';

import type { ChatProposal } from '../../api/client';
import { room, seedItem, storeFor, WALLS } from '../../test/kitchen';
import { askAssistant, type ChatApi } from './assistant';

const DESIGN = 'design-1';

function answer(overrides: Partial<ChatProposal> = {}): ChatProposal {
  return {
    conversation_id: 'conv-1',
    message_id: 'msg-1',
    text: '',
    tool_calls: [],
    question: '',
    errors: [],
    attempt: 0,
    retries_left: 2,
    ...overrides,
  };
}

const addBase = (offsetIn: number) => ({
  name: 'add_item',
  arguments: { catalogId: 'base.standard', widthIn: 30, wall: 'A', offsetIn },
});

/** A chat API that answers with the given proposals in order. */
function fakeApi(...answers: ChatProposal[]) {
  const [first, ...retries] = answers;
  return {
    sendChat: vi.fn().mockResolvedValue(first),
    retryChat: vi.fn<ChatApi['retryChat']>(async () => retries.shift()!),
    resolveChat: vi.fn().mockResolvedValue({}),
  } satisfies ChatApi;
}

/** Wall A with one base cabinet at 0. */
const kitchen = () =>
  storeFor(room(144, 120, seedItem('item-000001', 'base.standard', WALLS[0], 0)));

describe('askAssistant', () => {
  it('sends the summary, dry-runs the proposal and puts it in the store unapplied', async () => {
    const store = kitchen();
    const before = store.getState().doc;
    const api = fakeApi(answer({ tool_calls: [addBase(30)], text: 'Added.' }));

    const result = await askAssistant(api, store, DESIGN, 'Add a base', null);

    expect(api.sendChat).toHaveBeenCalledWith(DESIGN, {
      message: 'Add a base',
      summary: expect.stringContaining('c1 | base.standard | 30 x 34.5 x 24 | 0 | 0') as string,
      conversation_id: null,
    });
    expect(result).toEqual({
      conversationId: 'conv-1',
      outcome: {
        kind: 'proposal',
        messageId: 'msg-1',
        text: 'Added.',
        changes: ['Add 30" base cabinet on wall A at 30"'],
      },
    });
    const { doc, proposal } = store.getState();
    expect(doc).toBe(before);
    expect(proposal?.doc.items).toHaveLength(2);
    expect(proposal?.command.type).toBe('batch');
  });

  it('never shows a proposal that introduces an error: it asks again with the reasons', async () => {
    const store = kitchen();
    const api = fakeApi(
      answer({ tool_calls: [addBase(15)] }),
      answer({ message_id: 'msg-2', attempt: 1, retries_left: 1, tool_calls: [addBase(30)] }),
    );

    const result = await askAssistant(api, store, DESIGN, 'Add a base', 'conv-1');

    expect(api.retryChat).toHaveBeenCalledWith('msg-1', {
      errors: [expect.stringMatching(/^The change would cause this problem: /) as string],
      summary: expect.any(String) as string,
    });
    expect(result.outcome).toMatchObject({ kind: 'proposal', messageId: 'msg-2' });
  });

  it('retries a conversion error and a malformed proposal the server dropped', async () => {
    const store = kitchen();
    const api = fakeApi(
      answer({ tool_calls: [{ name: 'remove_item', arguments: { item: 'c9' } }] }),
      answer({ message_id: 'msg-2', retries_left: 1, errors: ['Tool call 1 (add_item): bad'] }),
      answer({
        message_id: 'msg-3',
        retries_left: 0,
        text: 'Which cabinet?',
        question: 'Which cabinet?',
      }),
    );

    const result = await askAssistant(api, store, DESIGN, 'Remove it', null);

    expect(api.retryChat.mock.calls.map(([id, body]) => [id, body.errors])).toEqual([
      ['msg-1', ['Tool call 1 (remove_item): There is no item c9 in the design.']],
      ['msg-2', ['Tool call 1 (add_item): bad']],
    ]);
    expect(result.outcome).toEqual({
      kind: 'question',
      messageId: 'msg-3',
      text: 'Which cabinet?',
    });
    expect(store.getState().proposal).toBeNull();
  });

  it('gives up after the last retry and reports it, with the assistant explanation', async () => {
    const store = kitchen();
    const api = fakeApi(
      answer({ tool_calls: [addBase(15)], retries_left: 0, text: 'It does not fit.' }),
    );

    const result = await askAssistant(api, store, DESIGN, 'Add a base', null);

    expect(result.outcome).toMatchObject({ kind: 'failed', text: 'It does not fit.' });
    expect(api.resolveChat).toHaveBeenCalledWith('msg-1', 'invalid');
    expect(store.getState().proposal).toBeNull();
  });

  it('shows plain text answers', async () => {
    const api = fakeApi(answer({ text: 'It has four walls.' }));
    const result = await askAssistant(api, kitchen(), DESIGN, 'How many walls?', null);
    expect(result.outcome).toEqual({
      kind: 'text',
      messageId: 'msg-1',
      text: 'It has four walls.',
    });
  });

  it('drops an answer if the design changed while the assistant worked', async () => {
    const store = kitchen();
    const api = fakeApi(answer({ tool_calls: [addBase(30)] }));
    api.sendChat.mockImplementation(async () => {
      store.getState().execute({ type: 'item.remove', id: 'item-000001' });
      return answer({ tool_calls: [addBase(30)] });
    });

    const result = await askAssistant(api, store, DESIGN, 'Add a base', null);

    expect(result.outcome).toEqual({ kind: 'stale', messageId: 'msg-1' });
    expect(api.resolveChat).toHaveBeenCalledWith('msg-1', 'rejected');
    expect(store.getState().proposal).toBeNull();
  });
});

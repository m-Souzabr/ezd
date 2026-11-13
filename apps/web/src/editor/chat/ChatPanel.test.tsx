import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, type ChatMessage, type ChatProposal } from '../../api/client';
import { DesignStoreProvider } from '../../store/context';
import { room, seedItem, storeFor, WALLS } from '../../test/kitchen';
import { ChatPanel } from './ChatPanel';
import { historyEntries } from './entries';

const [A] = WALLS;

const proposal = (overrides: Partial<ChatProposal> = {}): ChatProposal => ({
  conversation_id: 'conv-1',
  message_id: 'msg-1',
  text: 'Adding it.',
  tool_calls: [
    {
      name: 'add_item',
      arguments: { catalogId: 'base.standard', widthIn: 30, wall: 'A', offsetIn: 30 },
    },
  ],
  question: '',
  errors: [],
  attempt: 0,
  retries_left: 2,
  ...overrides,
});

function setup(answer: () => Promise<ChatProposal>) {
  const store = storeFor(room(144, 120, seedItem('item-000001', 'base.standard', A, 0)));
  vi.spyOn(api, 'getChat').mockResolvedValue({ conversation_id: null, messages: [] });
  vi.spyOn(api, 'getChatUsage').mockResolvedValue({
    month: '2026-11-01',
    input_tokens: 1000,
    output_tokens: 0,
    requests: 1,
    quota_tokens: 4000,
    remaining_tokens: 3000,
  });
  const chatApi = {
    sendChat: vi.fn(answer),
    retryChat: vi.fn(),
    resolveChat: vi.fn().mockResolvedValue({}),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DesignStoreProvider store={store}>
        <ChatPanel designId="design-1" chatApi={chatApi} />
      </DesignStoreProvider>
    </QueryClientProvider>,
  );
  return { store, chatApi };
}

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Message to the assistant'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

afterEach(() => vi.restoreAllMocks());

describe('ChatPanel', () => {
  it('shows a proposal, and Accept applies it as one undo step', async () => {
    const { store, chatApi } = setup(async () => proposal());
    const before = store.getState().doc;
    expect(await screen.findByTestId('chat-usage')).toHaveTextContent('25%');

    send('Add a 30 inch base on wall A');
    const group = await screen.findByRole('group', { name: 'Proposed change' });
    expect(within(group).getByText('Add 30" base cabinet on wall A at 30"')).toBeInTheDocument();
    expect(store.getState().doc).toBe(before);

    fireEvent.click(within(group).getByRole('button', { name: 'Accept' }));
    expect(store.getState().doc.items).toHaveLength(2);
    expect(store.getState().history.past).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Proposed change' })).toBeNull();
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(chatApi.resolveChat).toHaveBeenCalledWith('msg-1', 'accepted');

    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
  });

  it('Reject leaves the document unchanged', async () => {
    const { store, chatApi } = setup(async () => proposal());
    const before = store.getState().doc;
    send('Add a base');
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(store.getState().doc).toBe(before);
    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    expect(chatApi.resolveChat).toHaveBeenCalledWith('msg-1', 'rejected');
  });

  it('an edit by hand cancels the pending proposal', async () => {
    const { store, chatApi } = setup(async () => proposal());
    send('Add a base');
    await screen.findByRole('group', { name: 'Proposed change' });

    store.getState().execute({ type: 'item.remove', id: 'item-000001' });

    expect(await screen.findByText('Cancelled: the design was changed by hand')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Proposed change' })).toBeNull();
    expect(chatApi.resolveChat).toHaveBeenCalledWith('msg-1', 'rejected');
  });

  it('shows a clarifying question as a message', async () => {
    setup(async () => proposal({ tool_calls: [], text: '', question: 'Which wall?' }));
    send('Add a cabinet');
    expect(await screen.findByText('Which wall?')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Proposed change' })).toBeNull();
  });

  it('offers to try again after a failure, without doubling the message', async () => {
    let calls = 0;
    const { chatApi } = setup(async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(503, { detail: 'The assistant took too long.' });
      return proposal({ tool_calls: [], text: 'Done thinking.' });
    });
    send('Add a base');
    expect(await screen.findByRole('alert')).toHaveTextContent('The assistant took too long.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Done thinking.')).toBeInTheDocument();
    expect(screen.getAllByText('Add a base')).toHaveLength(1);
    await waitFor(() => expect(chatApi.sendChat).toHaveBeenCalledTimes(2));
  });
});

describe('historyEntries', () => {
  const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
    id: 'x',
    role: 'assistant',
    text: '',
    tool_calls: [],
    question: '',
    status: 'none',
    attempt: 0,
    parent: null,
    created_at: '2026-11-12T00:00:00Z',
    ...overrides,
  });

  it('shows each user message with its last attempt and what became of it', () => {
    const call = { name: 'remove_item', arguments: { item: 'c1' } };
    expect(
      historyEntries([
        message({ id: 'u1', role: 'user', text: 'Remove it' }),
        message({ id: 'a1', parent: 'u1', status: 'invalid', tool_calls: [call] }),
        message({ id: 'a2', parent: 'u1', attempt: 1, status: 'accepted', tool_calls: [call] }),
        message({ id: 'u2', role: 'user', text: 'Which walls?' }),
        message({ id: 'a3', parent: 'u2', question: 'Do you mean A?' }),
      ]),
    ).toEqual([
      { id: 'u1', role: 'user', text: 'Remove it' },
      { id: 'a2', role: 'assistant', text: 'Proposed a change.', status: 'accepted' },
      { id: 'u2', role: 'user', text: 'Which walls?' },
      { id: 'a3', role: 'assistant', text: 'Do you mean A?' },
    ]);
  });
});

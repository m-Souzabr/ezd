import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

import { api } from '../../api/client';
import { chatKey, chatUsageKey } from '../../api/keys';
import { useDesign, useDesignStore } from '../../store/context';
import { BUTTON } from '../panels/fields';
import { askAssistant, type ChatApi } from './assistant';
import { type Entry, historyEntries, outcomeEntry, STATUS_TEXT } from './entries';

const PRIMARY =
  'inline-flex items-center justify-center rounded border border-sky-600 bg-sky-600 px-3 py-1 ' +
  'text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-45 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';

function UsageMeter() {
  const usage = useQuery({ queryKey: chatUsageKey, queryFn: api.getChatUsage }).data;
  if (!usage) return null;
  const used = usage.quota_tokens - usage.remaining_tokens;
  const percent = Math.min(100, Math.round((used / Math.max(1, usage.quota_tokens)) * 100));
  return (
    <p className="text-xs text-slate-500" data-testid="chat-usage">
      {percent}% of this month&apos;s assistant allowance used
    </p>
  );
}

/**
 * The assistant, docked beside the editor. A proposal is drawn as ghosts in the views and
 * listed here; Accept executes it as one command, Reject drops it. Editing the design by
 * hand while one is pending cancels it.
 */
export function ChatPanel({ designId, chatApi = api }: { designId: string; chatApi?: ChatApi }) {
  const store = useDesignStore();
  const queryClient = useQueryClient();
  const proposal = useDesign((state) => state.proposal);
  const inputId = useId();
  const [draft, setDraft] = useState('');
  /** What was said in this session, after the stored history. */
  const [added, setAdded] = useState<Entry[]>([]);
  /** What became of each proposal since the page opened, by message id. */
  const [statuses, setStatuses] = useState<Record<string, NonNullable<Entry['status']>>>({});
  const [newConversationId, setConversationId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; text: string } | null>(null);
  /** The proposal being accepted or rejected from here, so its end is not a cancellation. */
  const resolving = useRef<string | null>(null);
  const pendingId = useRef<string | null>(null);
  const list = useRef<HTMLOListElement>(null);

  // Read once: what this session adds is kept in `added`, not refetched.
  const history = useQuery({
    queryKey: chatKey(designId),
    queryFn: () => api.getChat(designId),
    staleTime: Infinity,
  });
  const conversationId = newConversationId ?? history.data?.conversation_id ?? null;
  const entries = useMemo(
    () =>
      [...historyEntries(history.data?.messages ?? []), ...added].map((entry) =>
        statuses[entry.id] ? { ...entry, status: statuses[entry.id] } : entry,
      ),
    [history.data, added, statuses],
  );

  const setStatus = (id: string, status: NonNullable<Entry['status']>) =>
    setStatuses((current) => ({ ...current, [id]: status }));

  // A proposal that disappears without Accept or Reject was cancelled by an edit.
  useEffect(() => {
    const previous = pendingId.current;
    pendingId.current = proposal?.messageId ?? null;
    if (!previous || proposal?.messageId === previous) return;
    if (resolving.current === previous) {
      resolving.current = null;
      return;
    }
    setStatus(previous, 'cancelled');
    void chatApi.resolveChat(previous, 'rejected').catch(() => undefined);
  }, [proposal, chatApi]);

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
  }, [entries]);

  const ask = useMutation({
    mutationFn: (text: string) => askAssistant(chatApi, store, designId, text, conversationId),
    onMutate: (text) => {
      setFailure(null);
      setAdded((current) => [...current, { id: `local-${Date.now()}`, role: 'user', text }]);
    },
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      setAdded((current) => [...current, outcomeEntry(result.outcome)]);
    },
    onError: (error, text) => {
      // The message was not kept by the server; take it back out so a resend is not doubled.
      setAdded((current) => current.slice(0, -1));
      setFailure({ message: error.message, text });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: chatUsageKey }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || ask.isPending) return;
    setDraft('');
    ask.mutate(text);
  };

  const accept = () => {
    if (!proposal) return;
    const { messageId } = proposal;
    resolving.current = messageId;
    const executed = store.getState().acceptProposal();
    if (!executed.ok) {
      resolving.current = null;
      store.getState().notify(executed.error.message);
      return;
    }
    setStatus(messageId, 'accepted');
    void chatApi.resolveChat(messageId, 'accepted').catch(() => undefined);
  };

  const reject = () => {
    if (!proposal) return;
    const { messageId } = proposal;
    resolving.current = messageId;
    store.getState().propose(null);
    setStatus(messageId, 'rejected');
    void chatApi.resolveChat(messageId, 'rejected').catch(() => undefined);
  };

  return (
    <section aria-label="Assistant" className="flex min-h-0 flex-1 flex-col">
      <h2 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">
        Assistant
      </h2>
      <ol ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {entries.length === 0 && (
          <li className="text-slate-500">
            Ask for a change, such as &ldquo;Add a 30 inch base cabinet on wall A&rdquo;. You will
            see it before anything changes.
          </li>
        )}
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-role={entry.role}
            className={
              entry.role === 'user'
                ? 'ml-6 rounded-md bg-sky-50 px-2 py-1.5 text-slate-900'
                : 'mr-6 rounded-md bg-slate-100 px-2 py-1.5 text-slate-800'
            }
          >
            <p className="whitespace-pre-line">{entry.text}</p>
            {entry.changes && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {entry.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            )}
            {entry.status && entry.status !== 'pending' && (
              <p className="mt-1 text-xs text-slate-500">{STATUS_TEXT[entry.status]}</p>
            )}
          </li>
        ))}
        {ask.isPending && (
          <li className="mr-6 text-slate-500" role="status">
            Thinking…
          </li>
        )}
      </ol>

      {proposal && (
        <div
          role="group"
          aria-label="Proposed change"
          className="border-t border-slate-200 bg-emerald-50 px-3 py-2 text-sm"
        >
          <p className="font-medium text-slate-900">Proposed change</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-800">
            {proposal.changes.map((change, i) => (
              <li key={i}>{change}</li>
            ))}
          </ul>
          {proposal.warnings.length > 0 && (
            <ul aria-label="Warnings" className="mt-1 list-disc pl-5 text-xs text-amber-800">
              {proposal.warnings.map((warning, i) => (
                <li key={i}>{warning.message}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" className={PRIMARY} onClick={accept}>
              Accept
            </button>
            <button type="button" className={BUTTON} onClick={reject}>
              Reject
            </button>
          </div>
        </div>
      )}

      {failure && (
        <div
          role="alert"
          className="border-t border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>{failure.message}</p>
          <button
            type="button"
            className={`${BUTTON} mt-1`}
            onClick={() => ask.mutate(failure.text)}
            disabled={ask.isPending}
          >
            Try again
          </button>
        </div>
      )}

      <form onSubmit={submit} className="space-y-1 border-t border-slate-200 px-3 py-2">
        <label htmlFor={inputId} className="sr-only">
          Message to the assistant
        </label>
        <textarea
          id={inputId}
          value={draft}
          rows={2}
          maxLength={2000}
          placeholder="Ask for a change…"
          className="w-full resize-none rounded border border-slate-300 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event);
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <UsageMeter />
          <button type="submit" className={PRIMARY} disabled={ask.isPending || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

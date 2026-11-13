import { dryRunProposal, type ProposalError, summarizeForLLM, type ToolCall } from '@ezd/core';

import type { Api, ChatProposal } from '../../api/client';
import type { DesignStoreApi } from '../../store/designStore';

// One request to the assistant, from the user's message to something the chat can show.
// Every proposal is dry-run by core before the user sees it; one that does not convert, or
// that introduces an error-severity violation, goes back to the server for a retry. Nothing
// here changes the document: a valid proposal is only handed to the store as a preview.

export type ChatApi = Pick<Api, 'sendChat' | 'retryChat' | 'resolveChat'>;

/** The most characters of the design summary sent with a message. */
export const SUMMARY_MAX_CHARS = 8000;

export type Outcome =
  /** The proposal is in the store, waiting for Accept or Reject. */
  | { kind: 'proposal'; messageId: string; text: string; changes: string[] }
  | { kind: 'question'; messageId: string; text: string }
  | { kind: 'text'; messageId: string; text: string }
  /** Every attempt failed. `text` is the assistant's own explanation, if it gave one. */
  | { kind: 'failed'; messageId: string; text: string; reasons: string[] }
  /** The design changed while the assistant was working, so its answer was dropped. */
  | { kind: 'stale'; messageId: string };

/** A conversion or dry-run error, worded for the model with the call it is about. */
export const errorForModel = (error: ProposalError): string =>
  error.toolIndex >= 0
    ? `Tool call ${error.toolIndex + 1} (${error.tool}): ${error.message}`
    : error.message;

function summarize(store: DesignStoreApi) {
  const { doc, catalog, violations } = store.getState();
  return { doc, ...summarizeForLLM(doc, catalog, violations, { maxChars: SUMMARY_MAX_CHARS }) };
}

/**
 * Sends a message and follows the answer through the dry run and the retries. Resolves to
 * the conversation it belongs to and what to show. Throws what the API client throws.
 */
export async function askAssistant(
  api: ChatApi,
  store: DesignStoreApi,
  designId: string,
  message: string,
  conversationId: string | null,
): Promise<{ conversationId: string; outcome: Outcome }> {
  let summary = summarize(store);
  let answer: ChatProposal = await api.sendChat(designId, {
    message,
    summary: summary.text,
    conversation_id: conversationId,
  });
  const done = (outcome: Outcome) => ({ conversationId: answer.conversation_id, outcome });

  for (;;) {
    const messageId = answer.message_id;
    if (store.getState().doc !== summary.doc) {
      await api.resolveChat(messageId, 'rejected').catch(() => undefined);
      return done({ kind: 'stale', messageId });
    }
    if (answer.question) return done({ kind: 'question', messageId, text: answer.question });

    let errors = answer.errors;
    if (errors.length === 0) {
      if (answer.tool_calls.length === 0)
        return done({ kind: 'text', messageId, text: answer.text });
      const run = dryRunProposal(
        answer.tool_calls as ToolCall[],
        summary.aliases,
        summary.doc,
        store.getState().catalog,
      );
      if (run.ok) {
        store.getState().propose({
          messageId,
          command: run.command,
          doc: run.doc,
          changes: run.changes,
          warnings: run.introducedWarnings,
        });
        return done({ kind: 'proposal', messageId, text: answer.text, changes: run.changes });
      }
      errors = run.errors.map(errorForModel);
    }

    if (answer.retries_left <= 0) {
      await api.resolveChat(messageId, 'invalid').catch(() => undefined);
      return done({ kind: 'failed', messageId, text: answer.text, reasons: errors });
    }
    summary = summarize(store);
    answer = await api.retryChat(messageId, { errors, summary: summary.text });
  }
}

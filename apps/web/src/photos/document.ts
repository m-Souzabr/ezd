import {
  applyCommand,
  createEmptyDocument,
  type DesignDocument,
  draftToCommands,
  err,
  ok,
  type Result,
  type RoomDraft,
  type Catalog,
} from '@ezd/core';

import { newId } from '../editor/ids';

/** The design the draft becomes: core's commands applied to an empty document. */
export function buildDocument(
  draft: RoomDraft,
  name: string,
  catalog: Catalog,
): Result<DesignDocument, string[]> {
  const command = draftToCommands(draft, newId);
  if (!command.ok) return command;
  const empty = createEmptyDocument({ id: newId('design'), name });
  const applied = applyCommand(empty, command.value, { catalog });
  return applied.ok ? ok(applied.value.doc) : err([applied.error.message]);
}

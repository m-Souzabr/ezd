import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';

import { ApiError } from '@/api/client';

/**
 * Puts what the server said about each field under that field. `keys` names the server
 * fields that belong to a form field when they differ (a reset link's `token` is shown
 * under the new password). Anything the server said that no field shows is left to
 * `FormError`, which reads the same error.
 */
export function applyServerErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: unknown,
  fields: FieldPath<T>[],
  keys: Partial<Record<FieldPath<T>, string[]>> = {},
): void {
  if (!(error instanceof ApiError)) return;
  for (const name of fields) {
    const messages = (keys[name] ?? [name]).flatMap((key) => error.field(key));
    if (messages.length > 0) setError(name, { type: 'server', message: messages.join(' ') });
  }
}

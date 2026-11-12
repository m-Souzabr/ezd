import { ApiError } from '../api/client';

/** What to tell the user about a failed request. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong.';

/** The messages the server gave for one field of a form. */
export const fieldErrors = (error: unknown, name: string): string[] =>
  error instanceof ApiError ? error.field(name) : [];

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (iso: string): string => DATE.format(new Date(iso));

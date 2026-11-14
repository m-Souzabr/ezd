import { reportError } from './reportError';

// Outcomes the Control Panel expects and shows to the user: not signed in, not allowed, not
// found, a stale draft, a rejected form. Everything else is a fault worth reporting.
const EXPECTED = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Reports a failed Control Panel request through `reportError`, with what is safe to share:
 * the method, the status, and the section of the path (`catalog/entries`, never an id or a
 * query string). The server's message and the request body are left out on purpose, as they
 * can hold configuration contents and email addresses.
 */
export function reportAdminFailure(method: string, path: string, status: number | null): void {
  if (status !== null && EXPECTED.has(status)) return;
  // `/api/admin/<area>/<sub>/…`: the first two names after `admin`, never what follows.
  const [, , , area = '', sub = ''] = path.split('?')[0]!.split('/');
  const where = ['admin', area, sub].filter(Boolean).join('/');
  const what = status === null ? 'no answer' : `status ${status}`;
  reportError(new Error(`Control Panel request failed: ${method} ${where} (${what})`), {
    where,
    method,
    status,
  });
}

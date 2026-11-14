import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import { setErrorReporter } from './reportError';

const reports: { error: unknown; context: unknown }[] = [];
const restore = setErrorReporter((error, context) => reports.push({ error, context }));

function answer(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  reports.length = 0;
  vi.unstubAllGlobals();
});

describe('reporting a failed Control Panel request', () => {
  it('reports a server fault with the section of the path and nothing else', async () => {
    answer(500, { detail: 'Boom for admin@example.com: {"panels": {"secret": 1}}' });

    await expect(api.getConfigDraft()).rejects.toThrow();

    expect(reports).toHaveLength(1);
    expect(reports[0]!.context).toEqual({
      where: 'admin/config/draft',
      method: 'GET',
      status: 500,
    });
    const sent = JSON.stringify([String(reports[0]!.error), reports[0]!.context]);
    expect(sent).not.toContain('admin@example.com');
    expect(sent).not.toContain('secret');
  });

  it('keeps ids, entry names and query strings out of the path', async () => {
    answer(500, null);

    await expect(api.listAudit({ actor: 'jane@example.com' })).rejects.toThrow();
    await expect(api.rollbackCatalog('catalog-3')).rejects.toThrow();

    expect(reports.map((r) => r.context)).toEqual([
      { where: 'admin/audit', method: 'GET', status: 500 },
      { where: 'admin/catalog/versions', method: 'POST', status: 500 },
    ]);
    expect(JSON.stringify(reports)).not.toContain('jane');
    expect(JSON.stringify(reports)).not.toContain('catalog-3');
  });

  it('reports a request that got no answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(api.listRoles()).rejects.toThrow('could not be reached');

    expect(reports[0]!.context).toEqual({ where: 'admin/roles', method: 'GET', status: null });
  });

  it('does not report what the page already shows the user', async () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      answer(status, { detail: 'No.' });
      await expect(api.listRoles()).rejects.toThrow();
    }
    expect(reports).toEqual([]);
  });

  it('leaves the requests of other pages alone', async () => {
    answer(500, null);
    await expect(api.listProjects()).rejects.toThrow();
    expect(reports).toEqual([]);
  });
});

afterAll(restore);

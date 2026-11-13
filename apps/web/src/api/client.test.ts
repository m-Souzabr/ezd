import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  api,
  ApiError,
  isConflict,
  isRetriable,
  NetworkError,
  request,
  setUnauthorizedHandler,
} from './client';

type Call = { url: string; init: RequestInit };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Answers each request with the next response, and records what was sent. */
function mockFetch(...responses: (Response | Error | (() => Response))[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (next === undefined) throw new Error(`Unexpected request to ${url}`);
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : next;
    }),
  );
  return calls;
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];
const clearCookie = () => {
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
};

beforeEach(clearCookie);
afterEach(() => {
  vi.unstubAllGlobals();
  clearCookie();
});

describe('request', () => {
  it('reads without a CSRF header', async () => {
    const calls = mockFetch(json(200, [{ id: 'p1' }]));

    expect(await request('GET', '/api/projects/')).toEqual([{ id: 'p1' }]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect(header(calls[0]!, 'X-CSRFToken')).toBeUndefined();
  });

  it('sends the CSRF token from the cookie with an unsafe method', async () => {
    document.cookie = 'csrftoken=abc123; path=/';
    const calls = mockFetch(json(201, { id: 'p1', name: 'Cabin' }));

    await api.createProject('Cabin');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/projects/');
    expect(calls[0]!.init.method).toBe('POST');
    expect(header(calls[0]!, 'X-CSRFToken')).toBe('abc123');
    expect(header(calls[0]!, 'Content-Type')).toBe('application/json');
    expect(calls[0]!.init.body).toBe('{"name":"Cabin"}');
  });

  it('fetches the cookie first when there is none', async () => {
    const calls = mockFetch(
      () => {
        document.cookie = 'csrftoken=fresh; path=/';
        return json(401, { detail: 'not signed in' });
      },
      json(200, { id: 1, email: 'ada@example.com', name: 'Ada' }),
    );

    await api.login({ email: 'ada@example.com', password: 'secret' });

    expect(calls.map((call) => call.url)).toEqual(['/api/auth/me/', '/api/auth/login/']);
    expect(header(calls[1]!, 'X-CSRFToken')).toBe('fresh');
  });

  it('answers undefined for a 204', async () => {
    document.cookie = 'csrftoken=abc123; path=/';
    mockFetch(new Response(null, { status: 204 }));

    expect(await api.archiveProject('p1')).toBeUndefined();
  });

  it('throws an ApiError with the status, the body and its message', async () => {
    mockFetch(json(404, { detail: 'Not found.' }));

    const error = await request('GET', '/api/designs/x/').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: 'Not found.' });
  });

  it('exposes the messages of each field of a rejected form', async () => {
    document.cookie = 'csrftoken=abc123; path=/';
    mockFetch(json(400, { email: ['Already taken.'], password: ['Too short.', 'Too common.'] }));

    const error = (await api
      .register({ email: 'a@example.com', password: 'x', name: '' })
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.field('email')).toEqual(['Already taken.']);
    expect(error.field('password')).toEqual(['Too short.', 'Too common.']);
    expect(error.field('name')).toEqual([]);
    expect(error.message).toBe('Already taken. Too short. Too common.');
  });

  it('describes an error without a JSON body by its status', async () => {
    mockFetch(new Response('<html>Bad gateway</html>', { status: 502 }));

    const error = await request('GET', '/api/projects/').catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 502,
      body: null,
      message: 'The server had a problem. Try again in a moment.',
    });
  });

  it('throws a NetworkError when there is no answer', async () => {
    mockFetch(new TypeError('Failed to fetch'));

    await expect(request('GET', '/api/projects/')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('a 401', () => {
  it('calls the handler, which sends the user to the login page', async () => {
    const handler = vi.fn();
    const remove = setUnauthorizedHandler(handler);
    mockFetch(json(401, { detail: 'no session' }), json(401, { detail: 'no session' }));

    await expect(api.listProjects()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);

    remove();
    await expect(api.listProjects()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is an answer, not a redirect, for the session and the login form', async () => {
    document.cookie = 'csrftoken=abc123; path=/';
    const handler = vi.fn();
    const remove = setUnauthorizedHandler(handler);
    mockFetch(json(401, { detail: 'no session' }), json(401, { detail: 'Wrong password.' }));

    expect(await api.me()).toBeNull();
    await expect(api.login({ email: 'a@example.com', password: 'x' })).rejects.toMatchObject({
      message: 'Wrong password.',
    });

    expect(handler).not.toHaveBeenCalled();
    remove();
  });

  it('me passes on any other failure', async () => {
    mockFetch(json(500, { detail: 'boom' }));

    await expect(api.me()).rejects.toMatchObject({ status: 500 });
  });
});

describe('what a failure means', () => {
  it('retries when there was no answer, a server fault or a throttle', () => {
    expect(isRetriable(new NetworkError())).toBe(true);
    expect(isRetriable(new ApiError(503, null))).toBe(true);
    expect(isRetriable(new ApiError(429, null))).toBe(true);
    expect(isRetriable(new ApiError(409, null))).toBe(false);
    expect(isRetriable(new ApiError(422, null))).toBe(false);
    expect(isRetriable(new Error('other'))).toBe(false);
  });

  it('knows a conflict', () => {
    expect(isConflict(new ApiError(409, null))).toBe(true);
    expect(isConflict(new ApiError(400, null))).toBe(false);
    expect(isConflict(new NetworkError())).toBe(false);
  });
});

describe('the autosave request', () => {
  it('sends the document with the revision it is based on', async () => {
    document.cookie = 'csrftoken=abc123; path=/';
    const calls = mockFetch(json(200, { draft_revision: 5, updated_at: '2026-01-01T00:00:00Z' }));

    const saved = await api.saveDraft('d1', { id: 'd1' }, 4);

    expect(saved.draft_revision).toBe(5);
    expect(calls[0]!.url).toBe('/api/designs/d1/draft/');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      document: { id: 'd1' },
      base_revision: 4,
    });
  });
});

describe('the message for an error', () => {
  it("is the server's own, or a plain sentence, never a raw body", () => {
    expect(new ApiError(400, { detail: 'Not that.' }).message).toBe('Not that.');
    expect(new ApiError(400, { name: ['Too long.'], extra: { nested: 1 } }).message).toBe(
      'Too long.',
    );
    expect(new ApiError(404, null).message).toBe('This was not found. It may have been deleted.');
    expect(new ApiError(429, '<html>').message).toBe(
      'Too many requests. Wait a moment and try again.',
    );
    expect(new ApiError(418, { data: [{ x: 1 }] }).message).toBe(
      'The request did not succeed. Try again.',
    );
  });
});

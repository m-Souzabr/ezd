import type { components } from './schema';

// The one place that talks to the API. Types come from the OpenAPI file that the server
// generates (`pnpm --filter @ezd/web openapi`), so a change of the API shows up here as a
// type error.

type Schemas = components['schemas'];
export type User = Schemas['User'];
export type Project = Schemas['Project'];
export type Design = Schemas['Design'];
export type DesignSummary = Schemas['DesignSummary'];
export type DesignVersion = Schemas['DesignVersion'];
export type DesignVersionSummary = Schemas['DesignVersionSummary'];
export type DraftSaved = Schemas['DraftSaved'];
export type DraftConflict = Schemas['DraftConflict'];
export type DocumentIssue = Schemas['DocumentIssue'];

/** The server answered, but not with success. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The parsed JSON body, or null when there was none. */
    readonly body: unknown,
  ) {
    super(describe(status, body));
    this.name = 'ApiError';
  }

  /** The messages for one field of a rejected form, or an empty list. */
  field(name: string): string[] {
    const value = isRecord(this.body) ? this.body[name] : undefined;
    return Array.isArray(value) ? value.map(String) : [];
  }
}

/** The request never got an answer: the browser is offline or the server is down. */
export class NetworkError extends Error {
  constructor() {
    super('The server could not be reached.');
    this.name = 'NetworkError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function describe(status: number, body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.detail === 'string') return body.detail;
    const messages = Object.values(body).flatMap((value) =>
      Array.isArray(value) ? value.map(String) : [],
    );
    if (messages.length > 0) return messages.join(' ');
  }
  return `The request failed (${status}).`;
}

/** Worth trying again unchanged: no answer, a server fault, or a throttle. */
export const isRetriable = (error: unknown): boolean =>
  error instanceof NetworkError ||
  (error instanceof ApiError && (error.status >= 500 || error.status === 429));

export const isConflict = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 409;

let onUnauthorized: () => void = () => {};
/** What to do when a request that needs a session gets a 401: go to the login page. */
export function setUnauthorizedHandler(handler: () => void): () => void {
  onUnauthorized = handler;
  return () => {
    if (onUnauthorized === handler) onUnauthorized = () => {};
  };
}

const CSRF_COOKIE = 'csrftoken';
const ME = '/api/auth/me/';

function csrfToken(): string | null {
  const match = new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new NetworkError();
  }
}

type Options = {
  body?: unknown;
  /** A 401 is an answer here, not a reason to leave for the login page. */
  allowUnauthorized?: boolean;
};

/** Sends JSON and reads JSON. Unsafe methods carry the CSRF token from the cookie. */
export async function request<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    // `me` sets the cookie, also for a visitor who is not signed in.
    if (csrfToken() === null) await send(ME, { headers: { Accept: 'application/json' } });
    const token = csrfToken();
    if (token !== null) headers['X-CSRFToken'] = token;
  }

  const response = await send(path, {
    method,
    headers,
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;
  if (response.status === 401 && !options.allowUnauthorized) onUnauthorized();
  throw new ApiError(response.status, body);
}

const credentials = { allowUnauthorized: true };

export const api = {
  /** The signed-in user, or null. */
  async me(): Promise<User | null> {
    try {
      return await request<User>('GET', ME, credentials);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  register: (body: Schemas['RegisterRequest']) =>
    request<User>('POST', '/api/auth/register/', { body, ...credentials }),
  login: (body: Schemas['LoginRequest']) =>
    request<User>('POST', '/api/auth/login/', { body, ...credentials }),
  logout: () => request<void>('POST', '/api/auth/logout/', credentials),
  requestPasswordReset: (body: Schemas['PasswordResetRequest']) =>
    request<void>('POST', '/api/auth/password-reset/', { body, ...credentials }),
  confirmPasswordReset: (body: Schemas['PasswordResetConfirmRequest']) =>
    request<void>('POST', '/api/auth/password-reset/confirm/', { body, ...credentials }),

  listProjects: () => request<Project[]>('GET', '/api/projects/'),
  createProject: (name: string) => request<Project>('POST', '/api/projects/', { body: { name } }),
  getProject: (id: string) => request<Project>('GET', `/api/projects/${id}/`),
  renameProject: (id: string, name: string) =>
    request<Project>('PATCH', `/api/projects/${id}/`, { body: { name } }),
  archiveProject: (id: string) => request<void>('DELETE', `/api/projects/${id}/`),

  listDesigns: (projectId: string) =>
    request<DesignSummary[]>('GET', `/api/projects/${projectId}/designs/`),
  /** Without a document the server makes an empty one. A given one gets the new id. */
  createDesign: (projectId: string, body: { name?: string; document?: object } = {}) =>
    request<Design>('POST', `/api/projects/${projectId}/designs/`, { body }),
  getDesign: (id: string) => request<Design>('GET', `/api/designs/${id}/`),
  renameDesign: (id: string, name: string) =>
    request<Design>('PATCH', `/api/designs/${id}/`, { body: { name } }),
  deleteDesign: (id: string) => request<void>('DELETE', `/api/designs/${id}/`),
  saveDraft: (id: string, document: object, baseRevision: number) =>
    request<DraftSaved>('PUT', `/api/designs/${id}/draft/`, {
      body: { document, base_revision: baseRevision },
    }),

  listVersions: (designId: string) =>
    request<DesignVersionSummary[]>('GET', `/api/designs/${designId}/versions/`),
  createVersion: (designId: string, label: string) =>
    request<DesignVersionSummary>('POST', `/api/designs/${designId}/versions/`, {
      body: { label },
    }),
  getVersion: (designId: string, number: number) =>
    request<DesignVersion>('GET', `/api/designs/${designId}/versions/${number}/`),
  restoreVersion: (designId: string, number: number) =>
    request<Design>('POST', `/api/designs/${designId}/versions/${number}/restore/`),
};

export type Api = typeof api;

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
export type Quote = Schemas['Quote'];
export type QuoteSummary = Schemas['QuoteSummary'];
export type QuoteCreate = Schemas['QuoteCreateRequest'];
export type ChatProposal = Schemas['Proposal'];
export type ChatMessage = Schemas['Message'];
export type ChatConversation = Schemas['Conversation'];
export type ChatUsage = Schemas['Usage'];
export type LLMSettings = Schemas['LLMSettings'];
export type Photo = Schemas['Photo'];
export type PhotoDraft = Schemas['PhotoDraft'];
export type AdminUser = Schemas['AdminUser'];
export type AdminUserCreate = Schemas['AdminUserCreateRequest'];
export type AdminUserUpdate = Schemas['PatchedAdminUserUpdateRequest'];
export type AuditEntry = Schemas['AuditEntry'];
export type Role = Schemas['Role'];
export type PublicConfig = Schemas['AppConfig'];
export type ConfigDraft = Schemas['ConfigDraft'];
export type ConfigVersion = Schemas['ConfigVersion'];
export type PublicCatalog = Schemas['Catalog'];
export type CatalogDraft = Schemas['CatalogDraft'];
export type CatalogVersion = Schemas['CatalogVersion'];
export type CatalogValidation = Schemas['CatalogValidation'];
export type LLMSettingsUpdate = Schemas['PatchedLLMSettingsUpdateRequest'];

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

/** What to tell the user when the server gave no message of its own, as for an HTML page. */
const FALLBACK: Record<number, string> = {
  400: 'The request was not accepted. Check what you entered and try again.',
  401: 'Your session has ended. Sign in again.',
  403: 'You do not have access to this.',
  404: 'This was not found. It may have been deleted.',
  409: 'This was changed elsewhere. Reload to see the latest version.',
  413: 'This is too large to send.',
  429: 'Too many requests. Wait a moment and try again.',
};

function describe(status: number, body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.detail === 'string') return body.detail;
    const messages = Object.values(body).flatMap((value) =>
      Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [],
    );
    if (messages.length > 0) return messages.join(' ');
  }
  if (status >= 500) return 'The server had a problem. Try again in a moment.';
  return FALLBACK[status] ?? 'The request did not succeed. Try again.';
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

async function call(
  method: string,
  path: string,
  options: Options,
): Promise<{ response: Response; body: unknown }> {
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
  if (response.status === 204) return { response, body: undefined };
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return { response, body };
  if (response.status === 401 && !options.allowUnauthorized) onUnauthorized();
  throw new ApiError(response.status, body);
}

/** Sends JSON and reads JSON. Unsafe methods carry the CSRF token from the cookie. */
export async function request<T>(method: string, path: string, options: Options = {}): Promise<T> {
  return (await call(method, path, options)).body as T;
}

/** One page of a list, with the number of rows there are in all (`X-Total-Count`). */
export type Page<T> = { rows: T[]; total: number };

export async function requestPage<T>(path: string): Promise<Page<T>> {
  const { response, body } = await call('GET', path, {});
  const rows = body as T[];
  return { rows, total: Number(response.headers.get('X-Total-Count') ?? rows.length) };
}

/** The query string for the given parameters, leaving out those that are empty. */
export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/**
 * Sends a file as multipart form data and reads JSON, reporting how much was sent. The one
 * place besides `request` that talks to the API: `fetch` cannot report upload progress.
 */
export async function upload<T>(
  path: string,
  file: Blob,
  onProgress: (fraction: number) => void = () => {},
): Promise<T> {
  if (csrfToken() === null) await send(ME, { headers: { Accept: 'application/json' } });
  const body = new FormData();
  body.append('file', file);
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    const token = csrfToken();
    if (token !== null) xhr.setRequestHeader('X-CSRFToken', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new NetworkError());
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText) as unknown;
      } catch {
        // No JSON body.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
        return;
      }
      if (xhr.status === 401) onUnauthorized();
      reject(new ApiError(xhr.status, parsed));
    };
    xhr.send(body);
  });
}

export type UserListParams = {
  search?: string;
  is_active?: boolean;
  is_staff?: boolean;
  role?: string;
  sort?: string;
  limit?: number;
  offset?: number;
};
export type AuditListParams = { actor?: string; action?: string; limit?: number; offset?: number };

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

  listQuotes: (designId: string) =>
    request<QuoteSummary[]>('GET', `/api/designs/${designId}/quotes/`),
  /** Snapshots the draft as a new version and stores the quote for it. */
  createQuote: (designId: string, body: QuoteCreate) =>
    request<Quote>('POST', `/api/designs/${designId}/quotes/`, { body }),
  getQuote: (id: string) => request<Quote>('GET', `/api/quotes/${id}/`),
  deleteQuote: (id: string) => request<void>('DELETE', `/api/quotes/${id}/`),

  getChat: (designId: string) => request<ChatConversation>('GET', `/api/designs/${designId}/chat/`),
  /** Asks the assistant. Its tool calls are only a proposal: nothing is changed. */
  sendChat: (designId: string, body: Schemas['ChatRequestRequest']) =>
    request<ChatProposal>('POST', `/api/designs/${designId}/chat/`, { body }),
  retryChat: (messageId: string, body: Schemas['RetryRequestRequest']) =>
    request<ChatProposal>('POST', `/api/chat/messages/${messageId}/retry/`, { body }),
  resolveChat: (messageId: string, status: Schemas['ResolveRequestRequest']['status']) =>
    request<ChatMessage>('POST', `/api/chat/messages/${messageId}/resolve/`, {
      body: { status },
    }),
  getChatUsage: () => request<ChatUsage>('GET', '/api/chat/usage/'),

  listPhotos: (projectId: string) => request<Photo[]>('GET', `/api/projects/${projectId}/photos/`),
  /** Stored re-encoded, with no metadata. `onProgress` gets the fraction sent. */
  uploadPhoto: (projectId: string, file: Blob, onProgress?: (fraction: number) => void) =>
    upload<Photo>(`/api/projects/${projectId}/photos/`, file, onProgress),
  getPhoto: (id: string) => request<Photo>('GET', `/api/photos/${id}/`),
  deletePhoto: (id: string) => request<void>('DELETE', `/api/photos/${id}/`),
  /** The image itself, for an `<img>`: the browser sends the session cookie. */
  photoFileUrl: (id: string) => `/api/photos/${id}/file/`,
  /** Runs the vision model. The draft comes back `ready` or `failed`. */
  analyzePhoto: (id: string) => request<PhotoDraft>('POST', `/api/photos/${id}/analyze/`),
  getPhotoDraft: (id: string) => request<PhotoDraft>('GET', `/api/photo-drafts/${id}/`),
  updatePhotoDraft: (id: string, draft: object) =>
    request<PhotoDraft>('PATCH', `/api/photo-drafts/${id}/`, { body: { draft } }),
  /** Creates the design and its version 1 from the document built from the draft. */
  confirmPhotoDraft: (id: string, document: object, name?: string) =>
    request<Design>('POST', `/api/photo-drafts/${id}/confirm/`, {
      body: { document, ...(name && { name }) },
    }),
  discardPhotoDraft: (id: string) =>
    request<PhotoDraft>('POST', `/api/photo-drafts/${id}/discard/`),

  /** The Control Panel. Every route needs staff, and the permission named in its comment. */
  listUsers: (params: UserListParams) =>
    requestPage<AdminUser>(`/api/admin/users/${queryString(params)}`),
  inviteUser: (body: AdminUserCreate) => request<AdminUser>('POST', '/api/admin/users/', { body }),
  updateUser: (id: number, body: AdminUserUpdate) =>
    request<AdminUser>('PATCH', `/api/admin/users/${id}/`, { body }),
  resetUserPassword: (id: number) =>
    request<void>('POST', `/api/admin/users/${id}/reset-password/`),
  listRoles: () => request<Role[]>('GET', '/api/admin/roles/'),
  listAudit: (params: AuditListParams) =>
    requestPage<AuditEntry>(`/api/admin/audit/${queryString(params)}`),

  /** The published app configuration. Needs no session. */
  getConfig: () => request<PublicConfig>('GET', '/api/config/', { allowUnauthorized: true }),
  getConfigDraft: () => request<ConfigDraft>('GET', '/api/admin/config/draft/'),
  /** A stale `revision` is a 409; an invalid config is a 422 with `errors`. */
  saveConfigDraft: (revision: number, appConfig: object) =>
    request<ConfigDraft>('PUT', '/api/admin/config/draft/', {
      body: { revision, app_config: appConfig },
    }),
  /** Saves only the rules section. Needs `config.rules.edit`; core's paths come back in a 422. */
  saveRulesDraft: (revision: number, rulesConfig: object) =>
    request<ConfigDraft>('PUT', '/api/admin/config/draft/', {
      body: { revision, rules_config: rulesConfig },
    }),
  /** Saves only the quote defaults. Needs `config.quote.edit`. */
  saveQuoteDefaultsDraft: (revision: number, quoteDefaults: object) =>
    request<ConfigDraft>('PUT', '/api/admin/config/draft/', {
      body: { revision, quote_defaults: quoteDefaults },
    }),
  publishConfig: (revision: number, note: string) =>
    request<ConfigVersion>('POST', '/api/admin/config/publish/', { body: { revision, note } }),
  listConfigVersions: () => request<ConfigVersion[]>('GET', '/api/admin/config/versions/'),
  /** The published catalog. Needs no session. */
  getCatalog: () => request<PublicCatalog>('GET', '/api/catalog/', { allowUnauthorized: true }),
  /** An old published version, as a quote or design that used it needs it. */
  getCatalogVersion: (version: string) =>
    request<PublicCatalog>('GET', `/api/catalog/${encodeURIComponent(version)}/`, {
      allowUnauthorized: true,
    }),
  getCatalogDraft: () => request<CatalogDraft>('GET', '/api/admin/catalog/draft/'),
  /** A stale `revision` is a 409; something that is not a catalog at all is a 422. */
  saveCatalogDraft: (revision: number, catalog: object) =>
    request<CatalogDraft>('PUT', '/api/admin/catalog/draft/', { body: { revision, catalog } }),
  validateCatalog: (catalog?: object) =>
    request<CatalogValidation>('POST', '/api/admin/catalog/validate/', {
      body: catalog ? { catalog } : {},
    }),
  /** A catalog that breaks a rule is a 422 with `errors`. */
  publishCatalog: (revision: number, note: string) =>
    request<CatalogVersion>('POST', '/api/admin/catalog/publish/', { body: { revision, note } }),
  listCatalogVersions: () => request<CatalogVersion[]>('GET', '/api/admin/catalog/versions/'),
  rollbackCatalog: (version: string) =>
    request<CatalogVersion>(
      'POST',
      `/api/admin/catalog/versions/${encodeURIComponent(version)}/rollback/`,
      { body: {} },
    ),
  rollbackConfig: (number: number) =>
    request<ConfigVersion>('POST', `/api/admin/config/versions/${number}/rollback/`, { body: {} }),

  /** Staff only. The answer never holds the key, only its last four characters. */
  getLLMSettings: () => request<LLMSettings>('GET', '/api/llm/settings/'),
  updateLLMSettings: (body: LLMSettingsUpdate) =>
    request<LLMSettings>('PATCH', '/api/llm/settings/', { body }),
};

export type Api = typeof api;

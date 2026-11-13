// Query keys shared by more than one file.

/** The list of saved versions of a design. One version is this key and its number. */
export const versionsKey = (designId: string) => ['designs', designId, 'versions'] as const;

/** The quotes of a design. */
export const quotesKey = (designId: string) => ['designs', designId, 'quotes'] as const;

/** One stored quote, which never changes. */
export const quoteKey = (id: string) => ['quotes', id] as const;

/** The signed-in user's assistant usage this month. */
export const chatUsageKey = ['chat', 'usage'] as const;

/** The chat of a design. */
export const chatKey = (designId: string) => ['designs', designId, 'chat'] as const;

/** The site's assistant settings (staff only). */
export const llmSettingsKey = ['llm', 'settings'] as const;

/** The photos of a project. */
export const photosKey = (projectId: string) => ['projects', projectId, 'photos'] as const;

/** One photo draft. */
export const photoDraftKey = (id: string) => ['photo-drafts', id] as const;

/** The Control Panel's user list for one set of filters, and every user list by prefix. */
export const adminUsersKey = (params?: object) =>
  params ? (['admin', 'users', params] as const) : (['admin', 'users'] as const);

/** The seeded roles and their permissions. */
export const adminRolesKey = ['admin', 'roles'] as const;

/** The audit log for one set of filters. */
export const adminAuditKey = (params: object) => ['admin', 'audit', params] as const;

/** The draft of the app configuration being edited (staff only). */
export const configDraftKey = ['admin', 'config', 'draft'] as const;

/** The published versions of the app configuration (staff only). */
export const configVersionsKey = ['admin', 'config', 'versions'] as const;

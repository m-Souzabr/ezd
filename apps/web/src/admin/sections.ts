export type Section = {
  path: string;
  label: string;
  permission: string;
  /** Not built yet: shown disabled, with "Coming soon". */
  soon?: boolean;
};

export const SECTIONS: Section[] = [
  { path: 'catalog', label: 'Catalog', permission: 'config.catalog.edit' },
  { path: 'rules', label: 'Rules', permission: 'config.rules.edit', soon: true },
  { path: 'app', label: 'App settings', permission: 'config.app.edit' },
  { path: 'quotes', label: 'Quotes', permission: 'config.quote.edit', soon: true },
  { path: 'ai', label: 'AI', permission: 'llm.settings.edit' },
  { path: 'users', label: 'Users', permission: 'users.view' },
  { path: 'audit', label: 'Audit', permission: 'audit.view' },
];

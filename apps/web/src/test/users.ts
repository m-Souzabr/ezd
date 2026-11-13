import type { AdminUser, User } from '../api/client';

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 1,
  email: 'ada@example.com',
  name: 'Ada',
  is_staff: true,
  is_superuser: false,
  permissions: [],
  ...overrides,
});

export const makeAdminUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 2,
  email: 'bob@example.com',
  name: 'Bob',
  is_active: true,
  is_staff: false,
  is_superuser: false,
  roles: [],
  last_login: null,
  date_joined: '2026-01-02T03:04:05Z',
  active_projects: 3,
  chat_tokens_this_month: 1200,
  ...overrides,
});

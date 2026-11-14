import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

// Both can be moved when something else of yours already listens on them.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8010);
const CI = Boolean(process.env.CI);

// End-to-end tests drive the editor in a real browser against the Vite dev server, which
// is the build that exposes `window.__ezd`. The tests of accounts and saved designs also
// need the API: Django's `testserver` runs it on a database of its own (`test_ezd`, made
// empty on each start), so PostgreSQL must be up, as for pytest. It runs on its own port,
// so a `runserver` on 8000 is left alone. The API validates documents with `ezd-core`,
// which is built first.
export default defineConfig({
  testDir: './e2e',
  // Each test signs up its own account and makes its own data, so tests run side by side.
  fullyParallel: true,
  workers: CI ? 2 : 4,
  // The account flows sign up, save and reload several times; give them room under load.
  timeout: 60_000,
  forbidOnly: CI,
  // A test passes on its first run or not at all: fix a flaky test, never retry it.
  retries: 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /(config|catalog|rules|admin-panel|account-layout|editor-layout)\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // The app configuration and the catalog are global: publishing one changes every other
      // test's editor, so these run alone, after the rest, and put it back as they found it.
      name: 'config',
      testMatch: /(config|catalog)\.spec/,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // The rules and the quote defaults share the draft with the app configuration, so this
      // runs after those two, not beside them.
      name: 'rules',
      testMatch: /rules\.spec/,
      dependencies: ['config'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // The hardening specs edit the shared draft, publish and roll back, and change a role of
      // the seeded support user, so they run last and put everything back.
      name: 'panel',
      testMatch: /admin-panel\.spec/,
      dependencies: ['rules'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // The layout specs run on a phone, a tablet and a desktop. The `chromium` project at 1440 px
    // stays for everything else; Phase 21 adds the other specs to these. The editor's layout runs
    // on the tablet and the desktop: the editor is operable but cramped on a phone.
    {
      name: 'phone',
      testMatch: /account-layout\.spec/,
      use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'tablet',
      testMatch: /(account-layout|editor-layout)\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: 'desktop',
      testMatch: /(account-layout|editor-layout)\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command:
        'pnpm --filter @ezd/core-cli build && cd ../api && ' +
        `uv run python manage.py testserver tests/fixtures/empty.json tests/fixtures/staff.json --noinput --addrport 127.0.0.1:${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health/`,
      // Without the line the API logs for each request. The assistant answers from a script.
      env: {
        DJANGO_LOG_LEVEL: 'WARNING',
        LLM_VENDOR: 'fake',
        LLM_FAKE_SCRIPT: resolve('e2e/llm-script.json'),
        // Every test signs in from 127.0.0.1, in parallel.
        API_THROTTLE_LOGIN_IP: '1000/min',
        // The Control Panel specs sign in as the same staff account many times a minute.
        API_THROTTLE_LOGIN_EMAIL: '1000/min',
        API_THROTTLE_AUTH_IP: '1000/min',
        API_THROTTLE_LLM: '1000/min',
        API_THROTTLE_ADMIN: '1000/min',
        // Password reset emails, which the reset test reads.
        EMAIL_FILE_PATH: resolve('test-results/emails'),
      },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: `vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      env: { EZD_API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !CI,
    },
  ],
});

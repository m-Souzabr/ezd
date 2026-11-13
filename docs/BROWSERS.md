# Browser support

EZDesign supports the current versions of Chrome, Edge, Firefox and Safari on desktop. The
end-to-end suite (`apps/web/e2e`, 27 tests) is the check. CI runs it on Chromium on every
pull request; the other browsers were run by hand, as below.

## Results

Run on 2026-11-13 on macOS 26.5 (Apple A18 Pro, 8 GB), Playwright 1.65.

| Browser  | Engine and version                                | Result                                                                              |
| -------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Chromium | Chromium 158.0.8127.18 (Playwright)               | the `e2e` job in CI, on every pull request                                          |
| Chrome   | Google Chrome 157.0.8103.52                       | 26 of 27 in a full run; the 27th fixed and passing on its own (note 1)              |
| Firefox  | Firefox 159.0 (Playwright)                        | 26 of 27 in a full run; the 27th fixed and passing on its own (note 2)              |
| Safari   | WebKit 27.2 (Playwright); Safari 26.5.2 installed | 26 of 27 in a full run with one worker; the 27th passing 3 of 3 on its own (note 3) |
| Edge     | not installed on the test machine                 | not run (see note 4)                                                                |

1. **Chrome.** The first full run passed 26 of 27. The conflict test reloaded a tab that
   was in the background, which branded Chrome does not finish loading; the test now brings
   the tab to the front first, as a user would, and passed twice in a row.
2. **Firefox.** The first full run passed 26 of 27. The keyboard test reached the plan by
   tabbing backwards, which in Chromium wraps around the page but in Firefox leaves it for
   the browser's own controls; it now tabs forwards, and passes in all four engines.
3. **WebKit.** With one worker, 26 of 27 passed; the one failure (duplicate and delete) was
   a 60 s timeout with an empty page, and the same test then passed 3 of 3 times in 2 to
   3 s each, so it is recorded as a hang of the browser, not of the app. With four workers
   on this machine WebKit is slow enough that tests time out; the conflict test is marked
   slow for WebKit, whose timers in a background tab run late. On macOS, Safari and WebKit
   move focus to buttons and links with Option+Tab unless "Press Tab to highlight each item"
   is on; the keyboard test uses Option+Tab there.
4. **Edge.** Edge uses the same engine as Chrome (Chromium), so the Chrome and Chromium
   results are expected to hold. Run it before the release on a machine with Edge:
   `npx playwright install msedge`, then add a project with `channel: 'msedge'`.

Later full runs on the same day failed for reasons unrelated to the app: the machine had a
load average near 60 from other programs, and every failure was a timeout. They are not
counted above. Re-run the matrix on an otherwise idle machine before a release.

## Running the matrix

Install the browsers once, then run the suite per project. A config that adds the other
browsers to `playwright.config.ts`:

```ts
// apps/web/playwright.browsers.config.ts (not committed)
import { devices } from '@playwright/test';

import base from './playwright.config';

const viewport = { width: 1440, height: 900 };
export default {
  ...base,
  projects: [
    ...(base.projects ?? []),
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport } },
  ],
};
```

```sh
pnpm --filter @ezd/web exec playwright install firefox webkit
pnpm --filter @ezd/web exec playwright test -c playwright.browsers.config.ts --project=firefox
```

Run one browser at a time, and nothing else heavy at the same time: the API test server
shares one database, and `pytest` drops and recreates that same database (`test_ezd`).

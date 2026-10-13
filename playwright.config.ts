import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4399' },
  // Built site, not the dev server: only the build applies the CSP.
  // --ignore-lock keeps the server in the foreground when an AI agent runs the tests
  // (Astro 7 backgrounds it otherwise, which Playwright reads as an early exit).
  webServer: {
    command: 'pnpm build && exec node_modules/.bin/astro preview --port 4399 --ignore-lock',
    url: 'http://localhost:4399',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

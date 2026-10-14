import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// `pnpm parity`: preview, CSS export and sampler agree. Chromium and WebKit, as the roadmap gate asks.
export default defineConfig({
  ...base,
  testMatch: ['parity/**/*.spec.ts'],
  timeout: 120_000,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

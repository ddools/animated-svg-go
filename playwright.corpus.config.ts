import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// `pnpm corpus`. Separate from test:e2e: slower, and its pass mark is a rate, not all-green.
export default defineConfig({
  ...base,
  testMatch: ['corpus/**/*.spec.ts'],
  timeout: 120_000,
  reporter: [['dot']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

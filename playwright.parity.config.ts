import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// `pnpm parity`: preview, CSS export and sampler agree. Chromium and WebKit, as the roadmap gate asks.
export default defineConfig({
  ...base,
  testMatch: ['parity/**/*.spec.ts'],
  timeout: 120_000,
  projects: [
    // Linux Chromium antialiases text subpixel in an <img> but greyscale on a canvas. macOS, the only target, never does subpixel.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--disable-lcd-text'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

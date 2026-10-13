import { expect, test as base } from '@playwright/test';

/** A test that fails on any console error. CSP violations surface as console errors. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

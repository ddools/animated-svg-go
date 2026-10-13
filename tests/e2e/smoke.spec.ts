import { expect, test as base } from '@playwright/test';

// Fails any test that logs a console error. CSP violations surface as console errors.
const test = base.extend<{ errors: string[] }>({
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

test('landing page links to the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Animated SVG GO' })).toBeVisible();
  await page.getByRole('link', { name: 'Open the editor' }).click();
  await expect(page).toHaveURL(/\/editor\/?$/);
});

test('editor island mounts under the CSP', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.getByRole('heading', { name: 'Editor' })).toBeVisible();
  await expect(page.locator('meta[http-equiv="content-security-policy"]')).toHaveAttribute(
    'content',
    /default-src 'none'/,
  );
});

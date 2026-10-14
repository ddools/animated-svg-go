import { expect, test as base } from '@playwright/test';
import { test } from '../helpers/strict';

test('landing page links to the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Animated SVG GO' })).toBeVisible();
  await page.getByRole('link', { name: 'Open the editor' }).click();
  await expect(page).toHaveURL(/\/editor\/?$/);
});

test('editor island mounts under the CSP', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.getByText('Drop an SVG here')).toBeVisible();
  await expect(page.locator('meta[http-equiv="content-security-policy"]')).toHaveAttribute(
    'content',
    /default-src 'none'/,
  );
});

test.describe('when the editor fails to start', () => {
  // The plain test: the failure is deliberate, so console errors are expected.
  base('it says so, and a dropped file does not navigate away', async ({ page }) => {
    // Astro retries the import once with a query string, so block that too.
    await page.route(/\/_astro\/App\.[^/]*\.js(\?.*)?$/, (route) => route.abort());
    await page.goto('/editor');
    await expect(page.getByRole('alert')).toContainText('The editor failed to start');
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    expect(await page.evaluate(() => location.pathname)).toMatch(/\/editor\/?$/);
  });
});

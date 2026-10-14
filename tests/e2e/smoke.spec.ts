import { expect } from '@playwright/test';
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

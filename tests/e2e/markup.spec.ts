import { expect } from '@playwright/test';
import { test } from '../helpers/strict';

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="a" x="5" y="5" width="20" height="20" fill="red"/></svg>`;
const SHOTS = process.env.SHOTS;

test.beforeEach(async ({ page }) => {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  await page.evaluate(() => {
    const { editor, selection } = window.__asg!;
    selection.set([...editor.inventory!.nodes.values()].filter((n) => n.label === 'a').map((n) => n.key));
  });
});

test('effect bars keep their height as they stack', async ({ page }) => {
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '+ Fade' }).click();
  const bars = page.getByRole('list', { name: 'Effect bars' }).locator('li');
  await expect(bars).toHaveCount(6);
  for (const bar of await bars.all()) expect((await bar.boundingBox())!.height).toBeCloseTo(20, 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bars.png` });
});

test('the markup tab shows the animated SVG export', async ({ page }) => {
  await page.getByRole('button', { name: '+ Spin' }).click();
  await page.getByRole('tab', { name: 'Markup' }).click();
  await expect(page.getByTestId('markup')).toContainText('@keyframes');
  await expect(page.getByTestId('markup')).toContainText('<svg');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/markup.png` });
  await page.getByRole('tab', { name: 'Image' }).click();
  await expect(page.getByTestId('markup')).toHaveCount(0);
});

test('copy takes the markup and nothing else', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium lets a test grant clipboard access');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '+ Spin' }).click();
  await page.getByRole('tab', { name: 'Markup' }).click();
  await expect(page.getByTestId('markup')).toContainText('@keyframes');
  await page.getByTestId('canvas').getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied.' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^<svg[\s\S]*<\/svg>$/);
  expect(copied).not.toContain('Thanks');
});

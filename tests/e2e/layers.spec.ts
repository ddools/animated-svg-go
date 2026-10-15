import { expect } from '@playwright/test';
import { test } from '../helpers/strict';

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="group"><rect id="a" width="20" height="20"/></g><rect id="b" x="50" width="20" height="20"/></svg>`;

const SHOTS = process.env.SHOTS;

test.beforeEach(async ({ page }) => {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
});

/** The computed visibility of a shape in the sandbox, by its authored id. */
const visibility = (page: import('@playwright/test').Page, id: string) =>
  page.evaluate((id) => {
    const root = window.__asg!.editor.sandbox!.root;
    const element = root.querySelector(`[id$="-${id}"]`)!;
    return root.ownerDocument.defaultView!.getComputedStyle(element).visibility;
  }, id);

test('the eye hides a layer, and its children, in the preview only', async ({ page }) => {
  const exported = await page.evaluate(() => window.__asg!.editor.result!.svg);
  await page.getByRole('button', { name: 'Hide group' }).click();
  expect(await visibility(page, 'a')).toBe('hidden');
  expect(await visibility(page, 'b')).toBe('visible');
  await expect(page.getByRole('treeitem', { name: 'group, hidden' })).toBeVisible();
  await page.getByRole('treeitem', { name: 'b' }).focus();
  await page.keyboard.press('F2');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/layers.png`, clip: { x: 0, y: 0, width: 700, height: 200 } });
  await page.keyboard.press('Escape');
  // Nothing outside the preview changes.
  expect(await page.evaluate(() => window.__asg!.editor.result!.svg)).toBe(exported);
  expect(await page.evaluate(() => window.__asg!.project.past.length)).toBe(0);

  await page.getByRole('treeitem', { name: 'group, hidden' }).focus();
  await page.keyboard.press('h');
  expect(await visibility(page, 'a')).toBe('visible');
});

test('layers rename by double-click or F2, and undo', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'b' }).getByText('b', { exact: true }).dblclick();
  await page.getByRole('textbox', { name: 'Layer name' }).fill('Sun');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('treeitem', { name: 'Sun' })).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText('Sun');

  await page.getByRole('treeitem', { name: 'Sun' }).focus();
  await page.keyboard.press('F2');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem', { name: 'Sun' })).toBeVisible();

  await page.keyboard.press('Meta+z');
  await expect(page.getByRole('treeitem', { name: 'b' })).toBeVisible();
});

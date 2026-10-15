import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

// WCAG 2.2 AA, as far as a machine can tell. The manual checks are listed in docs/PLAN.md, Stage 7.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g id="group">
    <rect id="a" x="10" y="10" width="30" height="30" fill="red"/>
    <circle id="b" cx="70" cy="70" r="15" fill="blue"/>
  </g>
</svg>`;

async function scan(page: Page) {
  // A button fading in from disabled measures as low contrast until its transition ends.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
  // The drawing inside the sandbox is the uploader's markup, not ours. The iframe itself is still checked.
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).options({ iframes: false }).analyze();
  expect(violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function open(page: Page) {
  await page.goto('/editor');
  await page.waitForFunction(() => window.__asg !== undefined);
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} scheme`, () => {
    test.use({ colorScheme });

    for (const path of ['/', '/about', '/privacy']) {
      test(`page ${path}`, async ({ page }) => {
        await page.goto(path);
        await scan(page);
      });
    }

    test('empty editor', async ({ page }) => {
      await page.goto('/editor');
      await page.waitForFunction(() => window.__asg !== undefined);
      await scan(page);
    });

    test('editor with an effect active', async ({ page }) => {
      await open(page);
      await page.getByRole('treeitem').first().click();
      await page.getByRole('button', { name: '+ Spin' }).click();
      await page.getByRole('button', { name: 'Pause' }).click();
      // Layers inside a hidden one are dimmed. They still have to be readable.
      await page.getByRole('treeitem', { name: 'group' }).press('ArrowRight');
      await page.getByRole('button', { name: 'Hide group' }).click({ force: true });
      await expect(page.locator('[role=treeitem].opacity-70')).toHaveCount(2);
      await scan(page);
    });

    test('markup view', async ({ page }) => {
      await open(page);
      await page.getByRole('tab', { name: 'Markup' }).click();
      await scan(page);
    });

    test('load error', async ({ page }) => {
      await page.goto('/editor');
      await page.waitForFunction(() => window.__asg !== undefined);
      await page.locator('input[type=file]').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('not svg') });
      await expect(page.getByRole('alert')).toBeVisible();
      await scan(page);
    });
  });
}

/**
 * Presses Tab until the target has focus. Fails if Tab never reaches it.
 * Safari's Tab skips buttons and file inputs unless a setting is on. Option-Tab reaches everything.
 */
async function tabTo(page: Page, target: Locator, key: string) {
  for (let i = 0; i < 200; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`Tab never reached ${target}`);
}

// WCAG 2.1.1: the whole job, start to finish, without a mouse.
test('keyboard only: open, select, add, tune, export', async ({ page, browserName }) => {
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('/editor');
  await page.waitForFunction(() => window.__asg !== undefined);

  await tabTo(page, page.locator('input[type=file]'), tab);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (await chooser).setFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);

  await tabTo(page, page.getByRole('treeitem', { name: 'group' }), tab);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__asg!.selection.keys.size)).toBe(1);

  await tabTo(page, page.getByRole('button', { name: '+ Spin' }), tab);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__asg!.project.spec.effects.length)).toBe(1);

  const pivot = page.getByRole('slider', { name: /^Pivot across/ });
  await tabTo(page, pivot, tab);
  const before = await pivot.inputValue();
  await page.keyboard.press('ArrowRight');
  expect(await pivot.inputValue()).not.toBe(before);

  await tabTo(page, page.getByRole('button', { name: 'Download' }), tab);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toMatch(/\.svg$/);
});

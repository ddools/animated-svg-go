import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect id="box" x="20" y="20" width="60" height="60" fill="teal"/>
  <path id="line" d="M100 50H180" stroke="black" stroke-width="4"/>
</svg>`;

async function open(page: Page) {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
}

async function spinBox(page: Page) {
  await page.evaluate(() => {
    const { editor, selection } = window.__asg!;
    selection.set([...editor.inventory!.nodes.values()].filter((node) => node.label === 'box').map((node) => node.key));
  });
  await page.getByRole('button', { name: '+ Spin' }).click();
  await page.waitForFunction(() => Boolean(window.__asg!.playback.ir?.tracks.length));
}

async function downloaded(page: Page, format: string) {
  await page.getByLabel('Format').selectOption({ label: format });
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

test('export waits for an effect', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'Download' })).toBeDisabled();
  await expect(page.getByText('Add an effect to export.')).toBeVisible();
});

test('downloads each format', async ({ page }) => {
  await open(page);
  await spinBox(page);

  const svg = await downloaded(page, 'Animated SVG');
  expect(svg.name).toBe('logo-animated.svg');
  expect(svg.text).toMatch(/^<svg [^>]*data-asg="s[0-9a-f]{8}"[^>]*width="200" height="100"/);
  expect(svg.text).toContain('@keyframes');
  expect(svg.text).toContain('prefers-reduced-motion');

  const css = await downloaded(page, 'SVG + CSS');
  expect(css.name).toBe('logo-animated.html');
  expect(css.text).toMatch(/<\/svg>\n<style>\n@keyframes/);

  const js = await downloaded(page, 'SVG + JS');
  expect(js.text).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  expect(js.text).toContain('.animate(');
  await expect(page.getByRole('status').filter({ hasText: 'Downloaded' })).toBeVisible();
});

test('the JS snippet plays in a plain page', async ({ page, context }) => {
  await open(page);
  await spinBox(page);
  const { text } = await downloaded(page, 'SVG + JS');
  const plain = await context.newPage();
  await plain.route('http://plain.test/', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><body>${text}</body>` }));
  await plain.goto('http://plain.test/');
  expect(await plain.evaluate(() => document.getAnimations().length)).toBe(1);
});

test('copies to the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium lets a test grant clipboard access');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await spinBox(page);
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('@keyframes');
});

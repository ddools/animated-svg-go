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

async function downloadedBytes(page: Page, format: string) {
  await page.getByLabel('Format').selectOption({ label: format });
  await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

/** Sets the timeline's length, so the export has more frames to work through. */
async function lengthen(page: Page, seconds: number) {
  await page.evaluate((s) => window.__asg!.project.edit((spec) => Object.assign(spec, { duration: s })), seconds);
  await page.waitForFunction((s) => window.__asg!.playback.ir?.duration === s, seconds);
}

test('downloads a GIF and an MP4, with a size estimate for the GIF', async ({ page }) => {
  await open(page);
  await spinBox(page);

  await page.getByLabel('Format').selectOption({ label: 'GIF' });
  await expect(page.getByTestId('raster-summary')).toHaveText(/^720 × 360 px\. About [\d.]+ KB\.$/);
  const gif = await downloadedBytes(page, 'GIF');
  expect(gif.name).toBe('logo-animated.gif');
  expect(gif.bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  await expect(page.getByRole('status').filter({ hasText: 'Downloaded' })).toBeVisible();

  await page.getByLabel('Format').selectOption({ label: 'MP4 video' });
  await page.getByLabel('Width').selectOption({ label: '1080 px' });
  await expect(page.getByTestId('raster-summary')).toHaveText('1080 × 540 px.');
  const mp4 = await downloadedBytes(page, 'MP4 video');
  expect(mp4.name).toBe('logo-animated.mp4');
  expect(mp4.bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
});

test('GIF stops at 720 px wide', async ({ page }) => {
  await open(page);
  await spinBox(page);
  await page.getByLabel('Format').selectOption({ label: 'MP4 video' });
  await page.getByLabel('Width').selectOption({ label: '1080 px' });
  await page.getByLabel('Format').selectOption({ label: 'GIF' });
  await expect(page.getByLabel('Width')).toHaveValue('720');
  await expect(page.getByLabel('Width').locator('option')).toHaveText(['480 px', '720 px']);
});

test('cancel stops a GIF part way and saves nothing', async ({ page }) => {
  await open(page);
  await spinBox(page);
  await lengthen(page, 8);
  await page.getByLabel('Format').selectOption({ label: 'GIF' });
  await page.getByLabel('Frame rate').selectOption({ label: '30 fps' });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByRole('progressbar', { name: 'Export progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cancelled.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
  expect(downloads).toBe(0);
});

test('GIF and MP4 wait for a timeline of ten seconds or less', async ({ page }) => {
  await open(page);
  await spinBox(page);
  await lengthen(page, 12);
  await page.getByLabel('Format').selectOption({ label: 'GIF' });
  await expect(page.getByRole('button', { name: 'Download' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'GIF and MP4 take up to 10 seconds.' })).toBeVisible();
  // The text formats have no such limit.
  await page.getByLabel('Format').selectOption({ label: 'Animated SVG' });
  await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
});

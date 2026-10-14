import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const FIXTURE = `<svg ${NS} viewBox="0 0 100 100">
  <rect id="a" x="5" y="5" width="20" height="20" fill="red"/>
  <rect id="b" x="40" y="40" width="20" height="20" fill="green"/>
  <rect id="c" x="70" y="70" width="20" height="20" fill="blue"/>
</svg>`;

async function open(page: Page) {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
}

/** Selects all three rects and adds an effect. */
async function addEffect(page: Page, label = 'Spin') {
  await page.evaluate(() => {
    const { editor, selection } = window.__asg!;
    selection.set([...editor.inventory!.nodes.values()].filter((n) => ['a', 'b', 'c'].includes(n.label!)).map((n) => n.key));
  });
  await page.getByRole('button', { name: `+ ${label}` }).click();
  await page.waitForFunction(() => window.__asg!.playback.ir?.tracks.length !== undefined);
}

// Loosely typed on purpose: tests read fields that only some effects and easings have.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const effect = (page: Page, index = 0) => page.evaluate((i) => window.__asg!.project.spec.effects[i] as Loose, index);

test('easing presets, including springs, change the spec', async ({ page }) => {
  await open(page);
  await addEffect(page);
  const easing = page.getByRole('combobox', { name: 'Easing' });
  await easing.selectOption('Bouncy spring');
  expect((await effect(page)).timing.easing).toEqual({ kind: 'spring', bounce: 0.5 });
  await page.getByLabel('Bounce').fill('0.7');
  expect((await effect(page)).timing.easing).toEqual({ kind: 'spring', bounce: 0.7 });
  await easing.selectOption('Steps');
  await page.getByLabel('Steps', { exact: true }).fill('6');
  await page.getByLabel('Steps', { exact: true }).blur();
  await page.getByLabel('Jump at').selectOption('start');
  expect((await effect(page)).timing.easing).toEqual({ kind: 'steps', n: 6, pos: 'start' });
  await easing.selectOption('Ease out');
  expect((await effect(page)).timing.easing).toEqual({ kind: 'cubic', p: [0, 0, 0.58, 1] });
});

test('control points move by keyboard and by number, and clamp', async ({ page }) => {
  await open(page);
  await addEffect(page);
  const first = page.getByRole('slider', { name: 'First control point' });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  expect((await effect(page)).timing.easing).toEqual({ kind: 'cubic', p: [0.43, 0.01, 0.58, 1] });
  await page.keyboard.press('Shift+ArrowRight');
  expect((await effect(page)).timing.easing.p[0]).toBe(0.53);
  await expect(first).toHaveAttribute('aria-valuetext', 'x1 0.53, y1 0.01');
  await page.getByRole('slider', { name: 'Second control point' }).focus();
  await page.keyboard.press('Shift+ArrowUp');
  expect((await effect(page)).timing.easing.p[3]).toBe(1.1);
  await page.getByLabel('x1').fill('4');
  await page.getByLabel('x1').blur();
  expect((await effect(page)).timing.easing.p[0]).toBe(1);
  await page.getByLabel('y2').fill('-9');
  await page.getByLabel('y2').blur();
  expect((await effect(page)).timing.easing.p[3]).toBe(-5);
});

test('stagger turns on and off, and its gap and order are kept', async ({ page }) => {
  await open(page);
  await addEffect(page);
  const stagger = page.getByLabel('Stagger');
  expect((await effect(page)).stagger).toBeUndefined();
  await stagger.check();
  const on = (await effect(page)).stagger;
  expect(on).toMatchObject({ gap: 0.1, order: 'start' });
  expect(Number.isInteger(on.seed)).toBe(true);
  await page.getByLabel('Gap').fill('0.5');
  await page.getByLabel('Order').selectOption({ label: 'From the centre' });
  expect((await effect(page)).stagger).toMatchObject({ gap: 0.5, order: 'centre' });
  await stagger.uncheck();
  expect('stagger' in (await effect(page))).toBe(false);
  await expect(page.getByLabel('Gap')).toHaveCount(0);
});

test('shuffle picks a new seed in one undo step, and only shows with a seed', async ({ page }) => {
  await open(page);
  await addEffect(page);
  await expect(page.getByRole('button', { name: 'Shuffle' })).toHaveCount(0);
  await page.getByLabel('Stagger').check();
  const before = (await effect(page)).stagger.seed;
  const past = await page.evaluate(() => window.__asg!.project.past.length);
  await page.getByRole('button', { name: 'Shuffle' }).click();
  expect((await effect(page)).stagger.seed).not.toBe(before);
  expect(await page.evaluate(() => window.__asg!.project.past.length)).toBe(past + 1);
});

test('a bar per effect makes its effect active', async ({ page }) => {
  await open(page);
  await addEffect(page, 'Spin');
  await addEffect(page, 'Fade');
  const [spin, fade] = await page.evaluate(() => window.__asg!.project.spec.effects.map((e) => e.id));
  expect(await page.evaluate(() => window.__asg!.project.active)).toBe(fade);
  await page.getByRole('button', { name: /^Spin, 0\.00 to/ }).click();
  expect(await page.evaluate(() => window.__asg!.project.active)).toBe(spin);
  expect(await page.evaluate(() => window.__asg!.selection.keys.size)).toBe(3);
});

test('a staggered bar runs on past one run by the gap for every later target', async ({ page }) => {
  await open(page);
  await addEffect(page);
  await page.getByLabel('Stagger').check();
  await page.getByLabel('Gap').fill('0.25');
  // One 1 s run, two later targets at 0.25 s each.
  await expect(page.getByRole('button', { name: 'Spin, 0.00 to 1.50 seconds' })).toBeVisible();
});

test('keyboard plays, pauses and moves the playhead', async ({ page }) => {
  await open(page);
  await addEffect(page);
  await page.evaluate(() => window.__asg!.playback.pause());
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__asg!.playback.playing)).toBe(true);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__asg!.playback.playing)).toBe(false);
  await page.keyboard.press('End');
  expect(await page.evaluate(() => window.__asg!.playback.time)).toBe(2);
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.__asg!.playback.time)).toBe(0);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => window.__asg!.playback.time)).toBeCloseTo(1, 2);
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.__asg!.playback.time)).toBeCloseTo(1 - 1 / 30, 2);
});

test('keys type into fields instead of driving playback', async ({ page }) => {
  await open(page);
  await addEffect(page);
  await page.evaluate(() => window.__asg!.playback.pause());
  const length = page.getByLabel('Length');
  await length.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.__asg!.playback.playing)).toBe(false);
});

test('adding an effect starts playing', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => window.__asg!.playback.playing)).toBe(false);
  await addEffect(page);
  expect(await page.evaluate(() => window.__asg!.playback.playing)).toBe(true);
});

test('adding an effect does not autoplay under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await addEffect(page);
  expect(await page.evaluate(() => window.__asg!.playback.playing)).toBe(false);
});

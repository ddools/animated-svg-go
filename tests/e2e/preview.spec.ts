import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

// The rect carries its own skewing matrix inside translate, non-uniform scale and rotate groups.
// It is centrally symmetric, so its on-screen box centre is the image of its centre under any
// transform: a spin about the centre must leave that point exactly where it was.
const FIXTURE = `<svg ${NS} viewBox="0 0 400 300">
  <g transform="translate(50 40)"><g transform="scale(1.5 0.8)"><g transform="rotate(20 60 60)">
    <rect id="nested" x="20" y="30" width="80" height="40" fill="teal" stroke="black" stroke-width="4" transform="matrix(1 0.2 0.3 1 5 0)"/>
  </g></g></g>
  <path id="line" d="M20 250H380" stroke="black" stroke-width="6" stroke-linecap="round" fill="none"/>
  <circle id="dot" cx="300" cy="80" r="30" fill="orange"/>
</svg>`;

async function open(page: Page, text = FIXTURE) {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
}

/** Selects labelled shapes and adds an effect to them with the panel button. */
async function addEffect(page: Page, label: string, labels: string[]) {
  await page.evaluate((wanted) => {
    const { editor, selection } = window.__asg!;
    selection.set([...editor.inventory!.nodes.values()].filter((node) => wanted.includes(node.label!)).map((node) => node.key));
  }, labels);
  await page.getByRole('button', { name: `+ ${label}` }).click();
  await page.waitForFunction(() => window.__asg!.playback.ir?.tracks.length !== undefined);
}

/** Pauses at a time and lets the preview catch up with the spec. */
async function seek(page: Page, seconds: number) {
  await page.evaluate((s) => {
    const { playback } = window.__asg!;
    playback.refresh();
    playback.seek(s);
  }, seconds);
}

/** On-screen box of a labelled element, read inside the sandbox. */
const boxOf = (page: Page, label: string) =>
  page.evaluate((wanted) => {
    const { editor } = window.__asg!;
    const node = [...editor.inventory!.nodes.values()].find((n) => n.label === wanted)!;
    const { x, y, width, height } = editor.sandbox!.elementFor(node.key)!.getBoundingClientRect();
    return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
  }, label);

/** Every attribute of a labelled element and of its wrapper. */
const attributesOf = (page: Page, label: string) =>
  page.evaluate((wanted) => {
    const { editor } = window.__asg!;
    const node = [...editor.inventory!.nodes.values()].find((n) => n.label === wanted)!;
    const element = editor.sandbox!.elementFor(node.key)!;
    const read = (e: Element) => e.getAttributeNames().map((name) => `${name}=${e.getAttribute(name)}`);
    return [read(element), read(element.parentElement!)];
  }, label);

test('a spin inside nested authored transforms turns about its own centre', async ({ page }) => {
  await open(page);
  const before = await boxOf(page, 'nested');
  const attributes = await attributesOf(page, 'nested');
  await addEffect(page, 'Spin', ['nested']);

  await seek(page, 0);
  expect(await boxOf(page, 'nested')).toEqual(before);
  // Not 0.5 s: half a turn leaves a symmetric shape's box exactly as it was.
  for (const time of [0.1, 0.25, 0.4, 0.75]) {
    await seek(page, time);
    const during = await boxOf(page, 'nested');
    // Turning, so the box changes shape...
    expect(Math.abs(during.width - before.width) + Math.abs(during.height - before.height)).toBeGreaterThan(1);
    // ...but not where it is centred.
    expect(during.cx).toBeCloseTo(before.cx, 0);
    expect(during.cy).toBeCloseTo(before.cy, 0);
  }
  // Invariant 3: the animation is applied, never written.
  expect(await attributesOf(page, 'nested')).toEqual(attributes);
});

test('draw reveals a stroke along its length, on the element, without writing to it', async ({ page }) => {
  await open(page);
  const attributes = await attributesOf(page, 'line');
  await addEffect(page, 'Draw', ['line']);
  const dashOffset = () =>
    page.evaluate(() => {
      const { editor } = window.__asg!;
      const node = [...editor.inventory!.nodes.values()].find((n) => n.label === 'line')!;
      const element = editor.sandbox!.elementFor(node.key)!;
      return parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).strokeDashoffset);
    });
  // The path is 360 long. The default run is 1 s of a 2 s timeline, eased symmetrically.
  for (const [time, offset] of [
    [0, 360],
    [0.5, 180],
    [1, 0],
    [1.5, 0],
  ]) {
    await seek(page, time);
    expect(await dashOffset()).toBeCloseTo(offset, 0);
  }
  expect(await attributesOf(page, 'line')).toEqual(attributes);
});

test('effects say when they cannot do anything', async ({ page }) => {
  await open(page);
  await addEffect(page, 'Draw', ['dot']);
  await expect(page.getByTestId('effect-note')).toHaveText('1 shape has no stroke, so there is nothing to draw.');
});

test('play, pause and the playhead', async ({ page }) => {
  await open(page);
  await addEffect(page, 'Spin', ['dot']);
  const time = () => page.evaluate(() => window.__asg!.playback.time);
  await page.getByTestId('play').click();
  await expect.poll(time).toBeGreaterThan(0.1);
  await page.getByTestId('play').click();
  const paused = await time();
  await page.waitForTimeout(200);
  expect(await time()).toBe(paused);
  await page.getByRole('slider', { name: 'Playhead' }).fill('1.5');
  expect(await time()).toBe(1.5);
  await expect(page.getByTestId('time')).toHaveText('1.50 s / 2 s');
});

test('a slider drag is one undo step, and undo and redo restore the spec', async ({ page }) => {
  await open(page);
  await addEffect(page, 'Spin', ['dot']);
  const state = () =>
    page.evaluate(() => {
      const { project } = window.__asg!;
      return { effects: project.spec.effects.length, degrees: (project.spec.effects[0]?.params as { degrees?: number })?.degrees };
    });
  await page.getByRole('slider', { name: /Angle/ }).fill('90');
  expect(await state()).toEqual({ effects: 1, degrees: 90 });
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await state()).toEqual({ effects: 1, degrees: 360 });
  await page.keyboard.press('Meta+z');
  expect(await state()).toEqual({ effects: 0, degrees: undefined });
  await page.keyboard.press('Meta+Shift+z');
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await state()).toEqual({ effects: 1, degrees: 90 });
});

test('autosave offers the last file and its effects after a reload', async ({ page }) => {
  await open(page);
  await addEffect(page, 'Spin', ['dot']);
  const targets = await page.evaluate(() => window.__asg!.project.spec.effects[0].targets);
  // Saves are debounced by half a second.
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole('button', { name: 'Pick up where you left off: fixture.svg' }).click();
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  expect(await page.evaluate(() => window.__asg!.project.spec.effects.map((e) => [e.type, e.targets]))).toEqual([['spin', targets]]);
});

test('slider updates on 200 spinning shapes fit in a frame', async ({ page }) => {
  const rects = Array.from({ length: 200 }, (_, i) => `<rect x="${(i % 20) * 20}" y="${Math.floor(i / 20) * 20}" width="15" height="15" fill="hsl(${i} 70% 50%)"/>`);
  await open(page, `<svg ${NS} viewBox="0 0 400 200">${rects.join('')}</svg>`);
  await page.evaluate(() => {
    const { editor, selection } = window.__asg!;
    selection.set([...editor.inventory!.nodes.keys()]);
  });
  await page.getByRole('button', { name: '+ Spin' }).click();
  const average = await page.evaluate(() => {
    const { project, playback } = window.__asg!;
    playback.refresh();
    const start = performance.now();
    for (let i = 1; i <= 60; i++) {
      project.drag((spec) => void ((spec.effects[0].params as { degrees: number }).degrees = i * 6));
      playback.refresh();
    }
    project.settle();
    return (performance.now() - start) / 60;
  });
  console.log(`compile and apply for 200 shapes: ${average.toFixed(2)} ms`);
  expect(average).toBeLessThan(16);
});

import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const FIXTURE = `<svg ${NS} viewBox="0 0 200 100">
  <g id="badge">
    <defs><linearGradient id="grad"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
    <rect id="fill" width="40" height="40" fill="url(#grad)"/>
  </g>
  <rect id="b" x="60" width="20" height="20"/>
  <rect id="c" x="100" width="20" height="20"/>
  <g id="other"><rect id="d" x="150" width="20" height="20"/></g>
</svg>`;

async function open(page: Page, text = FIXTURE) {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
}

const tree = (page: Page) => page.getByRole('tree', { name: 'Layers' }).getByRole('treeitem');
/** The rows' names, top to bottom. */
const names = (page: Page) => tree(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')));
const rowsAre = (page: Page, expected: string[]) => expect.poll(() => names(page)).toEqual(expected);
const row = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const button = (page: Page, name: string) => page.getByRole('group', { name: 'Edit layers' }).getByRole('button', { name });

/** Keys by label, from the inventory. */
const keys = (page: Page, ...labels: string[]) =>
  page.evaluate((labels) => {
    const nodes = [...window.__asg!.editor.inventory!.nodes.values()];
    return labels.map((label) => nodes.find((node) => node.label === label)!.key);
  }, labels);

/** Every url(#…) and href="#…" in the drawing points at an ID that is there, and no ID is used twice. */
const referencesHold = (page: Page) =>
  page.evaluate(() => {
    const svg = window.__asg!.project.drawing!.svg;
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    const refs = [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((match) => match[1] ?? match[2]);
    return new Set(ids).size === ids.length && refs.length > 0 && refs.every((ref) => ids.includes(ref));
  });

test('delete takes layers out of the drawing, the export and effect targets, and undo puts them back', async ({ page }) => {
  await open(page);
  await row(page, 'b').click();
  await row(page, 'c').click({ modifiers: ['Meta'] });
  await page.getByRole('button', { name: '+ Fade' }).click();

  await row(page, 'b').click();
  await page.keyboard.press('Delete');
  await rowsAre(page, ['badge', 'c', 'other']);
  expect(await page.evaluate(() => window.__asg!.project.drawing!.svg)).not.toMatch(/id="a[0-9a-f]{8}-b"/);
  const [c] = await keys(page, 'c');
  expect(await page.evaluate(() => window.__asg!.project.spec.effects[0].targets)).toEqual([c]);
  expect(await page.evaluate(() => window.__asg!.selection.keys.size)).toBe(0);

  await page.keyboard.press('Meta+z');
  await rowsAre(page, ['badge', 'b', 'c', 'other']);
  expect(await page.evaluate(() => window.__asg!.project.spec.effects[0].targets.length)).toBe(2);
});

test('duplicate copies a group with its own gradient, which outlives the original', async ({ page }) => {
  await open(page);
  await row(page, 'badge').click();
  await button(page, 'Duplicate').click();
  await rowsAre(page, ['badge', 'badge', 'b', 'c', 'other']);
  // The copy is selected: the second row.
  await expect(tree(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(await referencesHold(page)).toBe(true);

  await tree(page).nth(0).click();
  await page.keyboard.press('Backspace');
  await rowsAre(page, ['badge', 'b', 'c', 'other']);
  expect(await referencesHold(page)).toBe(true);
  const fill = await page.evaluate(() => {
    const { sandbox } = window.__asg!.editor;
    const rect = sandbox!.root.querySelector('rect[fill^="url"]')!;
    return sandbox!.root.ownerDocument.getElementById(rect.getAttribute('fill')!.slice(5, -1))?.localName;
  });
  expect(fill).toBe('linearGradient');
});

test('group wraps siblings where the topmost one was, and only siblings', async ({ page }) => {
  await open(page);
  // Shift-click selects the range between two rows.
  await row(page, 'b').click();
  await row(page, 'other').click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.__asg!.selection.keys.size)).toBe(3);
  await page.keyboard.press('Meta+g');
  await rowsAre(page, ['badge', 'Group']);
  await expect(row(page, 'Group')).toContainText('g · 3');
  await expect(row(page, 'Group')).toHaveAttribute('aria-selected', 'true');
  // The group paints where "other" did, so nothing changes on screen.
  expect(await page.evaluate(() => window.__asg!.project.drawing!.svg.indexOf('-other"') > window.__asg!.project.drawing!.svg.indexOf('-badge"'))).toBe(true);

  await page.keyboard.press('Meta+z');
  await rowsAre(page, ['badge', 'b', 'c', 'other']);

  // A shape inside a group and one outside it are not siblings.
  const [fill, b] = await keys(page, 'fill', 'b');
  await page.evaluate((keys) => window.__asg!.selection.set(keys), [fill, b]);
  await expect(button(page, 'Group')).toBeDisabled();
  await expect(button(page, 'Duplicate')).toBeEnabled();
});

test('structure edits survive a reload', async ({ page }) => {
  await open(page);
  await row(page, 'b').click();
  await button(page, 'Delete').click();
  await row(page, 'c').click();
  await button(page, 'Duplicate').click();
  const before = await page.evaluate(() => window.__asg!.project.drawing!.svg);
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole('button', { name: 'Pick up where you left off: fixture.svg' }).click();
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  expect(await page.evaluate(() => window.__asg!.project.drawing!.svg)).toBe(before);
  await rowsAre(page, ['badge', 'c', 'c', 'other']);
});

test('ops from a hostile spec are skipped, not thrown, and copies stop at the caps', async ({ page }) => {
  const rects = Array.from({ length: 3000 }, (_, i) => `<rect x="${i % 100}" y="${Math.floor(i / 100)}" width="1" height="1"/>`).join('');
  await open(page, `<svg ${NS} viewBox="0 0 100 30"><g id="many">${rects}</g><g id="other"><rect id="d" width="1" height="1"/></g></svg>`);
  const [many, d] = await keys(page, 'many', 'd');
  const count = await page.evaluate(
    ([many, d]) => {
      const { project } = window.__asg!;
      project.replace({
        ...project.spec,
        structure: [
          { op: 'delete', keys: ['knothere'], seed: 1 },
          { op: 'group', keys: [many, d], seed: 2 },
          ...Array.from({ length: 12 }, (_, i) => ({ op: 'duplicate' as const, keys: [many], seed: 10 + i })),
        ],
      });
      return new DOMParser().parseFromString(project.drawing!.svg, 'image/svg+xml').querySelectorAll('*').length;
    },
    [many, d],
  );
  // Twice the pipeline's element cap, because every animatable element has a wrapper.
  expect(count).toBeLessThanOrEqual(40_000);
  expect(count).toBeGreaterThan(30_000);
  await page.waitForFunction(() => window.__asg!.editor.inventory!.nodes.size > 15_000);
  await expect(tree(page).first()).toHaveText(/many/);
});

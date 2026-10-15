import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g id="shapes" data-name="Shapes">
    <rect id="red-a" x="10" y="10" width="30" height="30" fill="red"/>
    <rect id="red-b" x="60" y="10" width="30" height="30" fill="red"/>
    <circle id="blue" cx="125" cy="25" r="15" fill="blue"/>
  </g>
  <g id="more" data-name="More">
    <path id="line" d="M10 80H190" stroke="black" stroke-width="4"/>
    <rect id="green" x="150" y="50" width="30" height="20" fill="green" stroke="black"/>
  </g>
  <defs><rect id="spare" width="1" height="1"/></defs>
</svg>`;

async function open(page: Page, text = FIXTURE) {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
}

/** Labels of the selected elements, sorted. */
const selected = (page: Page) =>
  page.evaluate(() => {
    const { editor, selection } = window.__asg!;
    return [...selection.keys].map((key) => editor.inventory!.nodes.get(key)!.label!).sort();
  });

/** Page coordinates of a labelled element's box inside the sandbox. */
async function boxOf(page: Page, label: string) {
  return page.evaluate((wanted) => {
    const { editor } = window.__asg!;
    const node = [...editor.inventory!.nodes.values()].find((n) => n.label === wanted)!;
    const inner = editor.sandbox!.elementFor(node.key)!.getBoundingClientRect();
    const frame = document.querySelector('iframe')!.getBoundingClientRect();
    return { x: frame.x + inner.x, y: frame.y + inner.y, width: inner.width, height: inner.height };
  }, label);
}

async function clickShape(page: Page, label: string, modifiers: ('Shift' | 'Meta')[] = []) {
  const box = await boxOf(page, label);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

test('the layer tree lists what is drawn, by name, and opens groups', async ({ page }) => {
  await open(page);
  const tree = page.getByRole('tree', { name: 'Layers' });
  await expect(tree.getByRole('treeitem')).toHaveText([/Shapes\s*g · 3/, /More\s*g · 2/]);
  // The chevron is hidden from assistive tech: keyboard users expand with the arrow keys.
  await tree.getByRole('treeitem', { name: 'Shapes' }).getByText('▸').click();
  await expect(tree.getByRole('treeitem')).toHaveText([/Shapes/, /red-a\s*rect/, /red-b/, /blue\s*circle/, /More/]);
  // Content in <defs> is drawn by reference, not in place.
  await expect(tree.getByRole('treeitem', { name: 'spare' })).toHaveCount(0);
});

test('clicking a shape selects it, and the tree follows', async ({ page }) => {
  await open(page);
  await clickShape(page, 'red-b');
  expect(await selected(page)).toEqual(['red-b']);
  await expect(page.getByRole('treeitem', { name: 'red-b' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('selection-summary')).toHaveText('red-b (rect, 30 × 30)');
  await expect(page.locator('[data-outline="selected"]')).toHaveCount(1);
});

test('shift-click adds, a click on empty space clears, hovering outlines', async ({ page }) => {
  await open(page);
  await clickShape(page, 'red-a');
  await clickShape(page, 'blue', ['Shift']);
  expect(await selected(page)).toEqual(['blue', 'red-a']);
  await expect(page.getByTestId('selection-summary')).toHaveText('2 selected');

  const blue = await boxOf(page, 'blue');
  await page.mouse.click(blue.x + blue.width + 5, blue.y - 5);
  expect(await selected(page)).toEqual([]);

  await page.mouse.move(blue.x + blue.width / 2, blue.y + blue.height / 2);
  await expect(page.locator('[data-outline="hover"]')).toHaveCount(1);
});

test('dragging on empty space lassoes the shapes it touches', async ({ page }) => {
  await open(page);
  const a = await boxOf(page, 'red-a');
  const blue = await boxOf(page, 'blue');
  await page.mouse.move(a.x - 4, a.y - 4);
  await page.mouse.down();
  await page.mouse.move(blue.x + blue.width / 2, blue.y + blue.height + 2, { steps: 5 });
  await expect(page.locator('[data-outline="lasso"]')).toHaveCount(1);
  await page.mouse.up();
  expect(await selected(page)).toEqual(['blue', 'red-a', 'red-b']);
});

test('select more like this', async ({ page }) => {
  await open(page);
  const tool = (name: string) => page.getByRole('group', { name: 'Select more like this' }).getByRole('button', { name });

  await clickShape(page, 'red-a');
  await tool('Same fill').click();
  expect(await selected(page)).toEqual(['red-a', 'red-b']);

  await clickShape(page, 'red-a');
  await tool('Same type').click();
  expect(await selected(page)).toEqual(['green', 'red-a', 'red-b']);

  await clickShape(page, 'red-a');
  await tool('Siblings').click();
  expect(await selected(page)).toEqual(['blue', 'red-a', 'red-b']);

  await clickShape(page, 'red-a');
  await tool('Parent group').click();
  expect(await selected(page)).toEqual(['Shapes']);

  await clickShape(page, 'line');
  await tool('Same stroke').click();
  expect(await selected(page)).toEqual(['green', 'line']);

  await tool('Clear').click();
  expect(await selected(page)).toEqual([]);
});

test('the tree works from the keyboard', async ({ page }) => {
  await open(page);
  await page.getByRole('treeitem', { name: 'Shapes' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('treeitem', { name: 'More' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('treeitem', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('treeitem', { name: 'line' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await selected(page)).toEqual(['line']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+Enter');
  expect(await selected(page)).toEqual(['green', 'line']);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('treeitem', { name: 'More' })).toBeFocused();
});

test('long sibling lists only render the rows in view', async ({ page }) => {
  const rects = Array.from({ length: 3000 }, (_, i) => `<rect id="r${i}" x="${i % 100}" y="${Math.floor(i / 100)}" width="1" height="1"/>`).join('');
  await open(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><g id="many">${rects}</g></svg>`);
  const many = page.getByRole('treeitem', { name: 'many' });
  await many.focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.getByRole('treeitem').count()).toBeLessThan(100);
  await page.keyboard.press('End');
  await expect(page.getByRole('treeitem', { name: 'r2999' })).toBeFocused();
  await expect(page.getByRole('treeitem', { name: 'r2999' })).toBeInViewport();
});

test('the file panel reports sizes, counts and notes', async ({ page }) => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const text = FIXTURE.replace(
    '</svg>',
    `<text x="10" y="95">Hi</text><image href="${png}" width="1" height="1"/><filter id="f"><feGaussianBlur stdDeviation="1"/></filter><rect filter="url(#f)" width="1" height="1"/></svg>`,
  );
  await open(page, text);
  const info = page.getByTestId('file-info');
  await expect(info).toContainText(`Original ${Buffer.byteLength(text)} B`);
  await expect(info).toContainText('Shapes and groups 10');
  await expect(info).toContainText('Defined for reuse 1');
  await expect(info).toContainText(/Gzipped \d/);
  await expect(page.getByRole('list', { name: 'Notes about this file' }).getByRole('listitem')).toHaveText([
    /1 embedded image/,
    /1 text element uses installed fonts/,
    /1 element has a filter/,
  ]);
});

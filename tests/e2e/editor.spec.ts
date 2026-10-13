import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test as plain, type Page } from '@playwright/test';
import { test } from '../helpers/strict';
import { payloads } from '../security/payloads';

const corpus = fileURLToPath(new URL('../corpus/files/', import.meta.url));
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const SIMPLE = `<svg ${NS} viewBox="0 0 100 100"><g id="layer" data-name="Layer one"><rect id="box" x="5" y="5" width="10" height="20" fill="red" stroke="blue" stroke-width="2"/><path id="line" d="M0 50H100" stroke="black"/></g><defs><circle id="dot" r="1"/></defs><rect id="blend" x="0" y="0" width="100" height="100" fill="#0f0" style="mix-blend-mode:multiply"/></svg>`;

const file = (name: string, text: string) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) });

async function open(page: Page, text = SIMPLE, name = 'simple.svg') {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles(file(name, text));
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
}

/** Runs inside the sandboxed document. */
const inSandbox = <T>(page: Page, fn: (doc: Document) => T) =>
  page.evaluate(`(${fn})(document.querySelector('iframe').contentDocument)`) as Promise<T>;

test('a picked file renders inside a script-less sandbox', async ({ page }) => {
  await open(page);
  await expect(page.getByText('simple.svg')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
  expect(await inSandbox(page, (doc) => doc.querySelectorAll('svg [data-k]').length)).toBe(5);
  // The drawing is in the iframe and nowhere in the app document.
  expect(await page.locator('[data-k]').count()).toBe(0);
});

test('a dropped file and pasted SVG text both load', async ({ page }) => {
  await page.goto('/editor');
  // The island hydrates after load. Wait for it before sending events it listens for.
  await page.waitForFunction(() => window.__asg !== undefined);
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.items.add(new File([text], 'dropped.svg', { type: 'image/svg+xml' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, cancelable: true }));
  }, SIMPLE);
  await expect(page.getByText('dropped.svg')).toBeVisible();

  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
  }, SIMPLE.replace('Layer one', 'Pasted layer'));
  await expect(page.getByText('Pasted SVG')).toBeVisible();
});

test('bad files get a plain explanation', async ({ page }) => {
  await page.goto('/editor');
  const input = page.locator('input[type=file]');
  await input.setInputFiles(file('notes.svg', 'just some text'));
  await expect(page.getByRole('alert')).toHaveText("That doesn't look like an SVG file.");
  await input.setInputFiles(file('huge.svg', `<svg ${NS}><!--${'x'.repeat(5 * 1024 * 1024)}--></svg>`));
  await expect(page.getByRole('alert')).toHaveText('That file is over 5 MB. Try a smaller one.');
});

test('leftover inline styles apply inside the sandbox without a CSP violation', async ({ page }) => {
  await open(page);
  const blend = await inSandbox(page, (doc) => {
    const rect = doc.querySelector('[id$="blend"]')!;
    return doc.defaultView!.getComputedStyle(rect).mixBlendMode;
  });
  expect(blend).toBe('multiply');
});

test('the inventory describes structure up front and measures on demand', async ({ page }) => {
  await open(page);
  const inventory = await page.evaluate(() => {
    const { nodes, roots, measure } = window.__asg!.editor.inventory!;
    const byLabel = (label: string) => [...nodes.values()].find((node) => node.label === label)!;
    const layer = byLabel('Layer one');
    const box = byLabel('box');
    const line = byLabel('line');
    return {
      roots: roots.length,
      layer: { type: layer.type, children: layer.children.length, parent: layer.parent },
      boxParentIsLayer: box.parent === layer.key,
      dotReferenced: byLabel('dot').referenced,
      box: measure(box.key),
      lineLength: measure(line.key)!.length,
    };
  });
  expect(inventory).toEqual({
    roots: 3,
    layer: { type: 'g', children: 2, parent: null },
    boxParentIsLayer: true,
    dotReferenced: true,
    // 10 x 20 at (5, 5), padded by half the 2 unit stroke.
    box: { bbox: { x: 4, y: 4, width: 12, height: 22 }, length: 60, fill: 'rgb(255, 0, 0)', stroke: 'rgb(0, 0, 255)', strokeWidth: 2, degenerate: false },
    lineLength: 100,
  });
});

test('the editor can ask the sandbox what is under a point', async ({ page }) => {
  await open(page, `<svg ${NS} viewBox="0 0 100 100"><rect id="left" width="50" height="100" fill="red"/><rect id="right" x="50" width="50" height="100" fill="blue"/></svg>`);
  const hits = await page.evaluate(() => {
    const { sandbox, inventory } = window.__asg!.editor;
    const { width, height } = document.querySelector('iframe')!.getBoundingClientRect();
    const labelAt = (x: number) => inventory!.nodes.get(sandbox!.elementAt(x, height / 2)?.getAttribute('data-k') ?? '')?.label;
    return [labelAt(width / 2 - 20), labelAt(width / 2 + 20)];
  });
  expect(hits).toEqual(['left', 'right']);
});

test('real files load without console errors or CSP violations', async ({ page }) => {
  const sample = ['heroicons/bell.svg', 'noto-emoji/volcano.svg', 'w3c/struct-use-01-t.svg', 'w3c/masking-mask-01-b.svg', 'w3c/filters-gauss-01-b.svg', 'w3c/pservers-pattern-01-b.svg', 'w3c/text-path-01-b.svg', 'w3c/styling-css-01-b.svg'];
  const [inkscape] = readdirSync(corpus + 'openclipart');
  const [wikimedia] = readdirSync(corpus + 'wikimedia');
  await page.goto('/editor');
  for (const name of [...sample, `openclipart/${inkscape}`, `wikimedia/${wikimedia}`]) {
    await page.locator('input[type=file]').setInputFiles(file(name, readFileSync(corpus + name, 'utf8')));
    await expect(page.getByText(name)).toBeVisible();
    await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  }
});

// Layer 2 must hold even if layer 1 fails. These tests skip the sanitiser on purpose,
// so they use the plain test: the browser rightly logs what the sandbox blocks.
plain.describe('the sandbox alone stops raw hostile markup', () => {
  const raw = ['script inline', 'script cdata', 'onload on root', 'onerror on image', 'image external', 'foreignObject script', 'xhtml iframe', 'xhtml img onerror', 'use external', 'style import', 'style attribute url', 'animate href to javascript'];
  for (const name of raw) {
    plain(name, async ({ page }) => {
      const seen = { dialogs: [] as string[], requests: [] as string[] };
      page.on('dialog', (dialog) => {
        seen.dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await page.route(/evil\.test/, (route) => {
        seen.requests.push(route.request().url());
        return route.abort();
      });
      await open(page);
      await page.evaluate((markup) => void window.__asg!.mountRaw(markup), payloads[name]);
      await page.waitForTimeout(200);
      expect(await inSandbox(page, (doc) => doc.querySelector('svg') !== null)).toBe(true);
      expect(seen).toEqual({ dialogs: [], requests: [] });
    });
  }
});

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
    // Firefox ignores clipboardData passed to the constructor, so attach it afterwards.
    const event = new ClipboardEvent('paste');
    Object.defineProperty(event, 'clipboardData', { value: data });
    window.dispatchEvent(event);
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
    box: { bbox: { x: 4, y: 4, width: 12, height: 22 }, length: 60, fill: 'rgb(255, 0, 0)', stroke: 'rgb(0, 0, 255)', strokeWidth: 2, dashed: false, degenerate: false },
    lineLength: 100,
  });
});

test('the inventory knows what can move, and measures dashes in their own units', async ({ page }) => {
  await open(
    page,
    `<svg ${NS} viewBox="0 0 100 100"><path id="scaled" d="M0 10H100" stroke="red" pathLength="1"/><path id="dashed" d="M0 20H50" stroke="red" stroke-dasharray="4 2"/><switch><rect id="branch" width="5" height="5"/></switch></svg>`,
  );
  const read = await page.evaluate(() => {
    const { nodes, measure } = window.__asg!.editor.inventory!;
    const byLabel = (label: string) => [...nodes.values()].find((node) => node.label === label)!;
    return {
      scaled: measure(byLabel('scaled').key)!.length,
      dashed: [measure(byLabel('dashed').key)!.dashed, measure(byLabel('scaled').key)!.dashed],
      wrapped: [byLabel('dashed').wrapped, byLabel('branch').wrapped],
    };
  });
  // pathLength rescales dashes. Children of <switch> are never wrapped.
  expect(read).toEqual({ scaled: 1, dashed: [true, false], wrapped: [true, false] });
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

type Seen = { fired: boolean; requests: string[] };

/**
 * Watches a page for script running in any frame and for requests made after `arm()`.
 * Requests are counted at the route, which only sees those the browser actually sends:
 * the plain request event also fires for ones a CSP has already blocked.
 */
async function watch(page: Page) {
  const seen: Seen = { fired: false, requests: [] };
  let armed = false;
  page.on('dialog', (dialog) => {
    seen.fired = true;
    void dialog.dismiss();
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (armed) seen.requests.push(url);
    return /evil\.test/.test(url) ? route.abort() : route.fallback();
  });
  return {
    seen,
    arm: () => (armed = true),
    // A sandboxed frame without allow-modals drops alert() silently, so replace it with a flag.
    stubAlert: () =>
      page.evaluate(() => {
        const frame = document.querySelector('iframe')!.contentWindow as Window & { alert: () => void };
        frame.alert = () => ((window as Window & { __fired?: boolean }).__fired = true);
      }),
    settle: async () => {
      await page.waitForTimeout(250);
      if (await page.evaluate(() => (window as Window & { __fired?: boolean }).__fired === true)) seen.fired = true;
      return seen;
    },
  };
}

plain.describe('the sandbox attribute is what stops script', () => {
  // A page with no CSP at all, so the iframe's sandbox attribute is the only thing under test.
  // The steps mirror mount(), minus its SVG-only filter, so XHTML payloads get through.
  const control = ['xhtml img onerror', 'onerror on image'];
  for (const sandboxed of [false, true]) {
    for (const name of control) {
      plain(`${name}, ${sandboxed ? 'sandboxed: silent' : 'no sandbox: fires'}`, async ({ page }) => {
        const watcher = await watch(page);
        await page.route('http://sink.test/**', (route) =>
          route.request().url() === 'http://sink.test/ctl'
            ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe ${sandboxed ? 'sandbox="allow-same-origin"' : ''}></iframe>` })
            : route.abort(),
        );
        await page.goto('http://sink.test/ctl');
        await watcher.stubAlert();
        await page.evaluate((markup) => {
          const doc = document.querySelector('iframe')!.contentDocument!;
          const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
          doc.body.replaceChildren(doc.importNode(parsed.documentElement, true));
        }, payloads[name]);
        expect((await watcher.settle()).fired).toBe(!sandboxed);
      });
    }
  }
});

plain.describe('the sandbox alone stops raw hostile markup', () => {
  const raw = ['script inline', 'script cdata', 'onload on root', 'onerror on image', 'onclick and friends', 'image external', 'foreignObject script', 'foreignObject iframe', 'xhtml iframe', 'xhtml img onerror', 'xhtml meta refresh', 'xhtml base', 'xhtml link stylesheet', 'xhtml embed and object', 'use external', 'style import', 'style attribute url', 'a href javascript', 'a href external', 'animate href to javascript'];
  for (const name of raw) {
    plain(name, async ({ page, context }) => {
      const watcher = await watch(page);
      await open(page);
      const url = page.url();
      await watcher.stubAlert();
      watcher.arm();
      await page.evaluate((markup) => {
        window.__asg!.mountRaw(markup);
        // Follow every link and fire every handler the markup might be waiting for.
        const doc = document.querySelector('iframe')!.contentDocument!;
        for (const element of doc.querySelectorAll('*')) {
          for (const type of ['load', 'error', 'focus', 'mouseover']) element.dispatchEvent(new Event(type));
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      }, payloads[name]);
      const seen = await watcher.settle();

      expect(seen).toEqual({ fired: false, requests: [] });
      expect(page.url()).toBe(url);
      expect(page.frames()).toHaveLength(2);
      expect(context.pages()).toHaveLength(1);
      const inside = await inSandbox(page, (doc) => ({
        location: doc.defaultView!.location.href,
        hasDrawing: doc.querySelector('svg') !== null,
        foreign: Array.from(doc.body.querySelectorAll('*')).filter((el) => el.namespaceURI !== 'http://www.w3.org/2000/svg').length,
      }));
      expect(inside).toEqual({ location: 'about:blank', hasDrawing: true, foreign: 0 });
    });
  }

  plain('the sandbox has its own policy, stricter than the page', async ({ page }) => {
    // The page policy allows same-origin images. The sandbox policy does not.
    const watcher = await watch(page);
    await open(page);
    watcher.arm();
    await page.evaluate(() => void window.__asg!.mountRaw('<svg xmlns="http://www.w3.org/2000/svg"><image href="/same-origin-probe.png" width="1" height="1"/></svg>'));
    expect((await watcher.settle()).requests).toEqual([]);
  });

  plain('named XHTML elements cannot break the next render', async ({ page }) => {
    await open(page);
    const rects = await page.evaluate(() => {
      const xhtml = 'xmlns="http://www.w3.org/1999/xhtml"';
      window.__asg!.mountRaw(`<svg xmlns="http://www.w3.org/2000/svg"><img ${xhtml} name="body"/><form ${xhtml} name="createElement"><input name="animate"/></form><embed ${xhtml} name="head"/></svg>`);
      window.__asg!.mountRaw('<svg xmlns="http://www.w3.org/2000/svg"><rect/><rect/></svg>');
      return document.querySelector('iframe')!.contentDocument!.querySelectorAll('svg rect').length;
    });
    expect(rects).toBe(2);
  });
});

test('measuring elements that are not rendered does not throw', async ({ page }) => {
  await open(page, `<svg ${NS} viewBox="0 0 10 10"><rect id="hidden" display="none" width="5" height="5"/><defs><path id="spare" d="M0 0H5"/></defs></svg>`);
  const measured = await page.evaluate(() => {
    const { nodes, measure } = window.__asg!.editor.inventory!;
    return [...nodes.values()].map((node) => typeof measure(node.key)!.bbox.width);
  });
  expect(measured).toEqual(['number', 'number']);
});

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext } from '@playwright/test';
import { normalise, openPipeline } from '../helpers/pipeline';
import { payloads } from './payloads';

const thirdPartyDir = fileURLToPath(new URL('./payloads/', import.meta.url));
const thirdParty = Object.fromEntries(
  readdirSync(thirdPartyDir)
    .filter((name) => name.endsWith('.svg'))
    .map((name) => [`third-party ${name}`, readFileSync(thirdPartyDir + name, 'utf8')]),
);
const all = { ...payloads, ...thirdParty };

const SINK = 'http://sink.test/doc';
type Sink = 'inline in HTML' | 'standalone SVG document';
const SINKS: Sink[] = ['inline in HTML', 'standalone SVG document'];

/**
 * Loads markup somewhere with no sandbox and no CSP, the worst place an export could end up,
 * and reports any script dialog or network request it causes.
 */
async function detonate(context: BrowserContext, markup: string, sink: Sink) {
  const page = await context.newPage();
  const seen = { dialogs: [] as string[], requests: [] as string[] };
  page.on('dialog', (dialog) => {
    seen.dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === SINK) {
      return sink === 'inline in HTML'
        ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><body>${markup}</body>` })
        : route.fulfill({ contentType: 'image/svg+xml', body: markup });
    }
    if (!url.startsWith('http://sink.test/favicon')) seen.requests.push(url);
    return route.abort();
  });
  await page.goto(SINK);
  // Fire the events that handler attributes and scriptable links wait for.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) {
      for (const type of ['load', 'error', 'focus', 'mouseover', 'click', 'beginEvent']) {
        element.dispatchEvent(new Event(type, { cancelable: true }));
      }
    }
  });
  await page.waitForTimeout(100);
  await page.close();
  return seen;
}

/** Static checks on the output tree. Runs in the browser so it uses a real XML parser. */
function inspect(markup: string): string[] {
  const SVG = 'http://www.w3.org/2000/svg';
  const FORBIDDEN = new Set(['script', 'style', 'foreignobject', 'set', 'animate', 'animatemotion', 'animatetransform', 'discard', 'handler', 'listener']);
  const RASTER = /^data:image\/(png|jpeg|gif|webp);base64,/i;
  const problems: string[] = [];
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) problems.push('output is not well-formed XML');
  for (const element of doc.querySelectorAll('*')) {
    const tag = element.localName;
    if (element.namespaceURI !== SVG) problems.push(`<${element.nodeName}> is not in the SVG namespace`);
    if (FORBIDDEN.has(tag.toLowerCase())) problems.push(`<${tag}> survived`);
    for (const { name, value } of Array.from(element.attributes)) {
      const attr = name.toLowerCase();
      if (attr.startsWith('xmlns')) continue;
      if (attr.startsWith('on')) problems.push(`handler ${name} on <${tag}>`);
      if (attr === 'xml:base') problems.push(`xml:base on <${tag}>`);
      if (attr === 'name') problems.push(`name on <${tag}>`);
      if (attr === 'id' && !/^a[0-9a-f]{4}-/.test(value)) problems.push(`id="${value}" is not namespaced`);
      if (attr === 'href' || attr === 'xlink:href') {
        const local = value.startsWith('#') || (tag === 'image' && RASTER.test(value));
        if (!local) problems.push(`${name}="${value.slice(0, 40)}" on <${tag}>`);
      } else if (/evil\.test/i.test(value) || /^\s*(javascript|vbscript|data):/i.test(value) || /url\(\s*['"]?(?!#)/i.test(value)) {
        problems.push(`${name}="${value.slice(0, 40)}" on <${tag}>`);
      }
    }
  }
  return problems;
}

test.describe('the trap works', () => {
  // Without these, every test below could pass because nothing was ever detected.
  for (const sink of SINKS) {
    test(`raw script and handler payloads fire a dialog, ${sink}`, async ({ context }) => {
      expect((await detonate(context, payloads['script inline'], sink)).dialogs).toContain('1');
      expect((await detonate(context, payloads['onload on root'], sink)).dialogs).toContain('1');
    });
    test(`a raw external image makes a request, ${sink}`, async ({ context }) => {
      expect((await detonate(context, payloads['image external'], sink)).requests).toEqual(['http://evil.test/pixel.png']);
    });
  }
});

test.describe('hostile files come out inert', () => {
  for (const [name, raw] of Object.entries(all)) {
    test(name, async ({ page, context }) => {
      await openPipeline(page);
      const out = await normalise(page, raw);
      // Refusing the file outright is a safe outcome.
      if (!out.ok) {
        expect(out.code).toBe('not-svg');
        return;
      }
      expect(await page.evaluate(inspect, out.svg)).toEqual([]);
      for (const sink of SINKS) {
        expect(await detonate(context, out.svg, sink), sink).toEqual({ dialogs: [], requests: [] });
      }
    });
  }
});

test('layer names are returned as plain strings, never markup', async ({ page }) => {
  await openPipeline(page);
  const out = await normalise(page, payloads['escaped markup in label attributes']);
  expect(out.ok && Object.values(out.labels)).toEqual(['"><img src=x onerror=alert(1)>']);
});

test('safe references survive sanitising', async ({ page }) => {
  await openPipeline(page);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const out = await normalise(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
      <defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>
        <filter id="f"><feGaussianBlur stdDeviation="1"/></filter><rect id="r" width="1" height="1"/></defs>
      <image href="${png}" width="1" height="1"/><use href="#r"/><use xlink:href="#r"/>
      <a href="#r"><rect fill="url(#g)" filter="url(#f)" style="mask:url(#m)" width="5" height="5"/></a></svg>`,
  );
  if (!out.ok) throw new Error(out.message);
  expect(out.svg).toContain(`href="${png}"`);
  expect(out.svg.match(/<use [^>]*href="#a[0-9a-f]{4}-r"/g)).toHaveLength(2);
  expect(out.svg).toMatch(/<a [^>]*href="#a[0-9a-f]{4}-r"/);
  expect(out.svg).toMatch(/fill="url\(#a[0-9a-f]{4}-g\)"/);
  expect(out.svg).toMatch(/filter="url\(#a[0-9a-f]{4}-f\)"/);
  expect(out.svg).toMatch(/url\(#a[0-9a-f]{4}-m\)/);
  expect(out.svg).toContain('<feGaussianBlur');
});

test('only the expected payloads are refused outright', async ({ page }) => {
  // Refusal is safe, but if most payloads were refused the tests above would prove little.
  await openPipeline(page);
  const refused: string[] = [];
  for (const [name, raw] of Object.entries(all)) {
    if (!(await normalise(page, raw)).ok) refused.push(name);
  }
  expect(refused).toEqual([
    'script svg prefix', // root element is not a plain <svg>
    'external entity', // SVGO's parser rejects it
    'third-party SVG_XSS1.svg', // these three are not well-formed XML
    'third-party SVG_XSS2.svg',
    'third-party SVG_XSS3.svg',
  ]);
});

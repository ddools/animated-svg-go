import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext } from '@playwright/test';
import type { IR } from '../../src/core/ir/types';
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
  // Real clicks: only a trusted click follows a javascript: link.
  for (const link of await page.locator('a').all()) {
    await link.click({ force: true, timeout: 1000 }).catch(() => {});
  }
  // Then the events that handler attributes wait for.
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

/**
 * Static checks on the output tree. Runs in the browser so it uses a real XML parser.
 * An export may carry one <style>, first in the root, that loads nothing.
 */
function inspect({ markup, exported = false }: { markup: string; exported?: boolean }): string[] {
  const SVG = 'http://www.w3.org/2000/svg';
  const FORBIDDEN = new Set(['script', 'style', 'foreignobject', 'set', 'animate', 'animatemotion', 'animatetransform', 'animatecolor', 'mpath', 'discard', 'handler', 'listener']);
  const RASTER = /^data:image\/(png|jpeg|gif|webp);base64,/i;
  const problems: string[] = [];
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) problems.push('output is not well-formed XML');
  // The export snippet is pasted into HTML, so the output must also survive an HTML parse intact.
  const html = new DOMParser().parseFromString(`<!doctype html><body>${markup}</body>`, 'text/html');
  if (html.head.children.length !== 0 || html.body.children.length !== 1) {
    problems.push('output does not stay inside one <svg> when parsed as HTML');
  }
  for (const element of html.body.querySelectorAll('*')) {
    if (element.namespaceURI !== SVG) problems.push(`<${element.nodeName}> leaves the SVG namespace when parsed as HTML`);
  }
  const keys = new Set(Array.from(doc.querySelectorAll('[data-k]'), (element) => element.getAttribute('data-k')));
  const ours = exported ? doc.documentElement.firstElementChild : null;
  if (exported && (ours?.localName !== 'style' || /url\(|@import/i.test(ours.textContent ?? ''))) problems.push('the export has no clean style first');
  for (const element of doc.querySelectorAll('*')) {
    const tag = element.localName;
    if (element.namespaceURI !== SVG) problems.push(`<${element.nodeName}> is not in the SVG namespace`);
    if (FORBIDDEN.has(tag.toLowerCase()) && element !== ours) problems.push(`<${tag}> survived`);
    for (const { name, value } of Array.from(element.attributes)) {
      const attr = name.toLowerCase();
      if (attr.startsWith('xmlns')) continue;
      if (attr.startsWith('on')) problems.push(`handler ${name} on <${tag}>`);
      if (attr === 'xml:base') problems.push(`xml:base on <${tag}>`);
      if (attr === 'name' || attr === 'xml:id') problems.push(`${name} on <${tag}>`);
      if (attr === 'data-k' && !/^k[0-9a-f]{8}$/.test(value)) problems.push(`data-k="${value}" was not made by the pipeline`);
      if (attr === 'data-for' && !keys.has(value)) problems.push(`data-for="${value}" points at no element`);
      if (attr === 'data-anim' && (tag !== 'g' || !element.hasAttribute('data-for'))) problems.push(`data-anim on <${tag}>`);
      if (attr === 'data-asg' && element !== doc.documentElement) problems.push(`data-asg on <${tag}>`);
      if (element === doc.documentElement && ['style', 'class', 'overflow', 'transform', 'transform-origin', 'filter'].includes(attr)) problems.push(`${name} on the root`);
      if (attr === 'id' && !/^a[0-9a-f]{8}-/.test(value)) problems.push(`id="${value}" is not namespaced`);
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
    test(`a raw javascript: link fires a dialog when clicked, ${sink}`, async ({ context }) => {
      expect((await detonate(context, payloads['a href javascript'], sink)).dialogs).toContain('1');
    });
    test(`a raw CSS url() makes a request, ${sink}`, async ({ context }) => {
      expect((await detonate(context, payloads['unterminated url in style'], sink)).requests).toContain('http://evil.test/x');
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
        expect(['not-svg', 'too-many-elements']).toContain(out.code);
        return;
      }
      expect(await page.evaluate(inspect, { markup: out.svg })).toEqual([]);
      for (const sink of SINKS) {
        expect(await detonate(context, out.svg, sink), sink).toEqual({ dialogs: [], requests: [] });
      }
    });
  }
});

/**
 * Every kind of output on the first animatable element, as the IR would have them: two stacked spins
 * (animation-composition, composite 'add'), a spring's linear() stops, a draw and a fill. No tracks if there is none.
 */
function animation(key: string | undefined): IR {
  const frames = (from: string, to: string, easing = 'linear') => [
    { offset: 0, value: from, easing },
    { offset: 1, value: to, easing: 'linear' },
  ];
  return {
    duration: 2,
    iterations: 'infinite',
    notes: [],
    tracks: key
      ? [
          { target: key, property: 'transform', keyframes: frames('rotate(0deg)', 'rotate(90deg)') },
          { target: key, property: 'transform', keyframes: frames('scale(0)', 'scale(1)', 'linear(0 0%, 1.2 40%, 1 100%)') },
          { target: key, property: 'stroke-dashoffset', keyframes: frames('10', '0') },
          { target: key, property: 'fill', keyframes: frames('rgb(255, 0, 0)', 'rgb(0, 0, 255)') },
        ]
      : [],
  };
}

test.describe('hostile files stay inert once exported', () => {
  for (const [name, raw] of Object.entries(all)) {
    test(name, async ({ page, context }) => {
      await openPipeline(page);
      const out = await normalise(page, raw);
      test.skip(!out.ok, 'refused');
      // With nothing to animate the export still runs: the XML serialise and HTML re-parse are what an mXSS payload targets.
      const key = out.ok ? out.svg.match(/data-k="(k[0-9a-f]{8})"/)?.[1] : undefined;
      const exported = await page.evaluate(
        ([svg, ir]) => {
          const { animatedSvg, jsSnippet, checkedExport, withStyle, frameCss, scopeOf } = window.__asg!.exports;
          const scope = scopeOf(svg, ir);
          // A raster frame takes the cheap path: checked once, then only its style is checked.
          return { svg: animatedSvg(svg, ir), js: jsSnippet(svg, ir), frame: withStyle(checkedExport(svg, scope), frameCss(ir, 0.5, scope)) };
        },
        [out.ok ? out.svg : '', animation(key)] as const,
      );
      // The new output forms really are in what gets detonated.
      if (key) {
        expect(exported.svg).toContain('animation-composition:add,add');
        expect(exported.svg).toContain('linear(0 0%, 1.2 40%, 1 100%)');
        expect(exported.svg).toContain('fill:rgb(255, 0, 0)');
        expect(exported.js).toContain('"add"');
      }
      expect(await page.evaluate(inspect, { markup: exported.svg, exported: true })).toEqual([]);
      for (const sink of SINKS) {
        expect(await detonate(context, exported.svg, sink), sink).toEqual({ dialogs: [], requests: [] });
      }
      expect(await detonate(context, exported.frame, 'inline in HTML'), 'raster frame').toEqual({ dialogs: [], requests: [] });
      // The snippet's script is ours and runs. Nothing else may.
      expect(await detonate(context, exported.js, 'inline in HTML')).toEqual({ dialogs: [], requests: [] });
    });
  }
});

test('the export check refuses a style that is not ours, and strips any other', async ({ page }) => {
  await openPipeline(page);
  const outcome = await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
    const attempt = (markup: string, style?: string) => {
      try {
        return window.__asg!.exports.exportMarkup(markup, 's1', style);
      } catch {
        return 'refused';
      }
    };
    const authored = svg.replace('<rect', '<style>body{display:none}</style><rect');
    return {
      remote: attempt(svg, 'rect{fill:url(http://evil.test/x)}'),
      import: attempt(svg, '@import "http://evil.test/x.css";'),
      escaped: attempt(svg, 'rect{fill:u\\72l(http://evil.test/x)}'),
      breakout: attempt(svg, 'rect{}</style><script>alert(1)</script><style>'),
      entity: attempt(svg, 'rect{fill:u&#x72;l(http://evil.test/x)}'),
      malformed: attempt(svg.replace('</svg>', '')),
      authored: attempt(authored),
      beside: attempt(authored, 'rect{}'),
      ours: attempt(svg, '[data-asg="s1"] [data-for="k1"]{animation:s1-0 1s linear 1 both}'),
    };
  });
  for (const name of ['remote', 'import', 'escaped', 'breakout', 'entity', 'malformed'] as const) expect(outcome[name], name).toBe('refused');
  // Uploads never carry a <style>. If one ever reached the export, the sanitiser strips it.
  expect(outcome.authored).not.toContain('<style');
  expect(outcome.beside.match(/<style>/g)).toEqual(['<style>']);
  expect(outcome.beside).toContain('<style>rect{}</style>');
  expect(outcome.ours).toMatch(/^<svg [^>]*data-asg="s1"[^>]*><style>\[data-asg="s1"\]/);
});

test('a regex backtracking bomb does not stall the main thread', async ({ page }) => {
  await openPipeline(page);
  const out = await normalise(page, payloads['regex backtracking bomb']);
  if (!out.ok) throw new Error(out.message);
  expect(out.timings.sanitise + out.timings.rewrite).toBeLessThan(2000);
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
  expect(out.svg.match(/<use [^>]*href="#a[0-9a-f]{8}-r"/g)).toHaveLength(2);
  expect(out.svg).toMatch(/<a [^>]*href="#a[0-9a-f]{8}-r"/);
  expect(out.svg).toMatch(/fill="url\(#a[0-9a-f]{8}-g\)"/);
  expect(out.svg).toMatch(/filter="url\(#a[0-9a-f]{8}-f\)"/);
  expect(out.svg).toMatch(/url\(#a[0-9a-f]{8}-m\)/);
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
    'use href with control character', // a control character is not legal XML
    'use expansion bomb', // over the expanded-shape limit
    'third-party SVG_XSS1.svg', // these three are not well-formed XML
    'third-party SVG_XSS2.svg',
    'third-party SVG_XSS3.svg',
  ]);
});

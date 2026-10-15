import { expect, test, type Page } from '@playwright/test';
import { normalise, openPipeline } from '../helpers/pipeline';

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

async function run(page: Page, raw: string) {
  const out = await normalise(page, raw);
  if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
  return out;
}

test.beforeEach(async ({ page }) => openPipeline(page));

test('derives a viewBox from physical units and drops the fixed size', async ({ page }) => {
  const { svg } = await run(page, `<svg ${NS} width="1in" height="25.4mm"><rect width="10" height="10"/></svg>`);
  expect(svg).toMatch(/viewBox="0 0 96 96(\.0+\d*)?"/);
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/);
  expect(svg).not.toMatch(/<svg[^>]*\sheight=/);
});

test('keeps an authored viewBox and warns when there is no size at all', async ({ page }) => {
  const kept = await run(page, `<svg ${NS} viewBox="5 5 20 20" width="400"><rect/></svg>`);
  expect(kept.svg).toContain('viewBox="5 5 20 20"');
  expect(kept.warnings).toEqual([]);
  const unsized = await run(page, `<svg ${NS}><rect/></svg>`);
  expect(unsized.svg).toContain('viewBox="0 0 300 150"');
  expect(unsized.warnings).toEqual(['no-size']);
});

test('namespaces ids and rewrites every reference to them', async ({ page }) => {
  const { svg } = await run(
    page,
    `<svg ${NS} viewBox="0 0 10 10" aria-labelledby="t"><title id="t">Logo</title>
      <defs><linearGradient id="g"><stop offset="0"/></linearGradient><rect id="r" width="1" height="1"/></defs>
      <rect fill="url(#g)" style="mask:url(#m)"/><use xlink:href="#r"/><use href="#r"/></svg>`,
  );
  const prefix = /id="(a[0-9a-f]{8}-)g"/.exec(svg)?.[1];
  expect(prefix).toBeTruthy();
  expect(svg).toContain(`aria-labelledby="${prefix}t"`);
  expect(svg).toContain(`fill="url(#${prefix}g)"`);
  expect(svg).toContain(`url(#${prefix}m)`);
  expect(svg.match(new RegExp(`href="#${prefix}r"`, 'g'))).toHaveLength(2);
});

test('wraps animatable elements, but not referenced content or switch branches', async ({ page }) => {
  const { svg } = await run(
    page,
    `<svg ${NS} viewBox="0 0 10 10">
      <defs><path id="d" d="M0 0"/></defs><clipPath id="c"><rect/></clipPath>
      <g id="group"><circle r="1"/></g>
      <switch><g systemLanguage="fr"><text>fr</text></g><g><text>en</text></g></switch>
    </svg>`,
  );
  const doc = await page.evaluate((markup) => {
    const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    const parentOf = (selector: string) => root.querySelector(selector)?.parentElement;
    return {
      parseError: root.querySelector('parsererror') !== null,
      wrappers: root.querySelectorAll('g[data-anim]').length,
      keys: new Set(Array.from(root.querySelectorAll('[data-k]'), (el) => el.getAttribute('data-k'))).size,
      stamped: root.querySelectorAll('[data-k]').length,
      groupWrapped: parentOf('g[id$="group"]')?.getAttribute('data-for') === root.querySelector('g[id$="group"]')?.getAttribute('data-k'),
      circleWrapped: parentOf('circle')?.hasAttribute('data-anim'),
      defsPathWrapped: parentOf('defs path')?.hasAttribute('data-anim'),
      clipRectWrapped: parentOf('clipPath rect')?.hasAttribute('data-anim'),
      switchBranches: Array.from(root.querySelector('switch')!.children, (el) => el.hasAttribute('data-anim')),
      switchTextWrapped: parentOf('switch text')?.hasAttribute('data-anim'),
    };
  }, svg);
  expect(doc).toEqual({
    parseError: false,
    // group, circle, and the two <text> elements inside the switch branches
    wrappers: 4,
    keys: 8,
    stamped: 8,
    groupWrapped: true,
    circleWrapped: true,
    defsPathWrapped: false,
    clipRectWrapped: false,
    switchBranches: [false, false],
    switchTextWrapped: true,
  });
});

test('harvests layer names, preferring editor labels', async ({ page }) => {
  const { labels } = await run(
    page,
    `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10">
      <g id="layer1" inkscape:label="Sky"><rect id="rect7" data-name="Cloud"/></g>
      <circle id="sun"><title>Sun disc</title></circle><path id="path9" d="M0 0"/></svg>`,
  );
  expect(Object.values(labels).sort()).toEqual(['Cloud', 'Sky', 'Sun disc', 'path9']);
});

test('inlines class styles through the worker and reports dropped CSS', async ({ page }) => {
  const out = await run(
    page,
    `<svg ${NS} viewBox="0 0 10 10"><style>.a{fill:#f00}@media print{.a{fill:#000}}</style><rect class="a"/></svg>`,
  );
  expect(out.svg).toContain('fill="red"');
  expect(out.svg).not.toContain('<style');
  expect(out.warnings).toEqual(['style-dropped']);
});

test('is deterministic', async ({ page }) => {
  const raw = `<svg ${NS} viewBox="0 0 10 10"><g id="a"><rect id="b"/></g></svg>`;
  expect((await run(page, raw)).svg).toBe((await run(page, raw)).svg);
});

test('rejects files over the limits and files that are not SVG', async ({ page }) => {
  const big = `<svg ${NS}>${'<g/>'.repeat(20_001)}</svg>`;
  expect(await normalise(page, big)).toMatchObject({ ok: false, code: 'too-many-elements' });
  const deep = `<svg ${NS}>${'<g>'.repeat(70)}${'</g>'.repeat(70)}</svg>`;
  expect(await normalise(page, deep)).toMatchObject({ ok: false, code: 'too-deep' });
  const huge = `<svg ${NS}><!--${'x'.repeat(5 * 1024 * 1024)}--></svg>`;
  expect(await normalise(page, huge)).toMatchObject({ ok: false, code: 'too-large' });
  expect(await normalise(page, '<svg><g></svg>')).toMatchObject({ ok: false, code: 'not-svg' });
  expect(await normalise(page, '<html><body>hi</body></html>')).toMatchObject({ ok: false, code: 'not-svg' });
});

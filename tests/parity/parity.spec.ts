// `pnpm parity`: preview must equal export (invariant 7). For fixed times, renders the WAAPI preview,
// the CSS export in <img>, and the sampler's static frame in <img>, and pixel-diffs them.
import { expect, test, type Page } from '@playwright/test';
import type { IR } from '../../src/core/ir/types';
import type { Effect, Spec } from '../../src/core/spec/schema';
import { compare, render } from '../helpers/render';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

// Nested authored transforms (the M3 fixture), a stroked path, a filled circle, and a group of strokes.
const FIXTURE = `<svg ${NS} viewBox="0 0 400 300">
  <g transform="translate(50 40)"><g transform="scale(1.5 0.8)"><g transform="rotate(20 60 60)">
    <rect id="nested" x="20" y="30" width="80" height="40" fill="teal" stroke="black" stroke-width="4" transform="matrix(1 0.2 0.3 1 5 0)"/>
  </g></g></g>
  <path id="line" d="M20 250H380" stroke="black" stroke-width="6" stroke-linecap="round" fill="none"/>
  <circle id="dot" cx="300" cy="80" r="30" fill="orange"/>
  <g id="pair">
    <path d="M40 200 L180 160" stroke="crimson" stroke-width="8" fill="none"/>
    <circle cx="250" cy="180" r="20" fill="none" stroke="navy" stroke-width="6" pathLength="10"/>
  </g>
</svg>`;

// The fixture's viewBox, scaled so the longest side is the corpus render size. Every render uses this box.
const BOX = { width: 512, height: 384 };

// Share of pixels allowed to differ. The worst measured in M4 was 0.002% (Chromium, preview vs CSS);
// WebKit and the sampler matched to the pixel. The control test below shows 50 ms out is well over this.
const TOLERANCE = 0.0005;

// Away from jumps, run ends and half turns.
const TIMES = [0.13, 0.62, 1.37, 1.9];

type Draft = {
  type: Effect['type'];
  labels: string[];
  params?: object;
  timing?: Partial<Effect['timing']>;
  pivot?: Effect['pivot'];
  stagger?: Effect['stagger'];
};
const EASE_IN_OUT = { kind: 'cubic', p: [0.42, 0, 0.58, 1] } as const;

const SCENARIOS: { name: string; loop?: boolean; effects: Draft[] }[] = [
  { name: 'spin, eased, inside nested transforms', effects: [{ type: 'spin', labels: ['nested'], params: { degrees: 270 }, timing: { duration: 2 } }] },
  { name: 'spin about an off-centre pivot', effects: [{ type: 'spin', labels: ['nested'], params: { degrees: 100 }, timing: { duration: 2 }, pivot: { fx: 0, fy: 1 } }] },
  { name: 'fade in late, then hold', effects: [{ type: 'fade', labels: ['dot'], params: { from: 0, to: 1 }, timing: { start: 0.5, duration: 1 } }] },
  { name: 'slide in from the left, fading up', effects: [{ type: 'slide', labels: ['dot'], params: { from: 'left', distance: 30, fade: 0 }, timing: { duration: 1.5 } }] },
  { name: 'pop with overshoot, about the centre', effects: [{ type: 'pop', labels: ['dot'], params: { from: 0.1 }, timing: { duration: 1.5 } }] },
  { name: 'draw a line', effects: [{ type: 'draw', labels: ['line'], params: { from: 0, to: 100 }, timing: { duration: 1.5 } }] },
  { name: 'draw every stroke in a group', effects: [{ type: 'draw', labels: ['pair'], params: { from: 20, to: 90 }, timing: { duration: 2 } }] },
  {
    name: 'spin and fade together, alternating',
    effects: [
      { type: 'spin', labels: ['nested'], params: { degrees: 120 }, timing: { iterations: 2, direction: 'alternate' } },
      { type: 'fade', labels: ['nested'], params: { from: 1, to: 0.2 }, timing: { iterations: 2, direction: 'alternate' } },
    ],
  },
  { name: 'steps, reversed', effects: [{ type: 'draw', labels: ['line'], timing: { duration: 2, direction: 'reverse', easing: { kind: 'steps', n: 5, pos: 'end' } } }] },
  {
    name: 'two spins stacked on one shape, about different pivots',
    effects: [
      { type: 'spin', labels: ['nested'], params: { degrees: 200 }, timing: { duration: 2 } },
      { type: 'spin', labels: ['nested'], params: { degrees: -90 }, timing: { start: 0.4, duration: 1 }, pivot: { fx: 0, fy: 0 } },
    ],
  },
  {
    name: 'a bouncing spring, there and back',
    effects: [{ type: 'spin', labels: ['nested'], params: { degrees: 90 }, timing: { iterations: 2, direction: 'alternate', easing: { kind: 'spring', bounce: 0.6 } } }],
  },
  {
    name: 'a random stagger, looping',
    effects: [
      {
        type: 'fade',
        labels: ['nested', 'line', 'dot', 'pair'],
        params: { from: 0, to: 1 },
        timing: { duration: 0.6 },
        stagger: { gap: 0.35, order: 'random', seed: 42 },
      },
    ],
  },
  {
    name: 'colour shift on a fill and a group of strokes',
    effects: [
      { type: 'colour', labels: ['dot'], params: { property: 'fill', to: '#3355ff' }, timing: { duration: 1.5 } },
      { type: 'colour', labels: ['pair'], params: { property: 'stroke', to: '#22aa44' }, timing: { duration: 2 } },
    ],
  },
  { name: 'a timeline that plays once', loop: false, effects: [{ type: 'fade', labels: ['dot', 'nested'], params: { from: 0.1, to: 1 }, timing: { duration: 2 } }] },
];

/** Loads the fixture into the editor, sized to BOX, with a white page behind the drawing. */
async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'parity.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  await page.evaluate((box) => {
    const iframe = document.querySelector('iframe')!;
    Object.assign(iframe.style, { width: `${box.width}px`, height: `${box.height}px` });
    iframe.contentDocument!.body.style.background = '#fff';
  }, BOX);
}

/** Sets the spec, targeting shapes by label, and returns what every backend needs. */
async function load(page: Page, loop: boolean, drafts: Draft[]): Promise<{ svg: string; ir: IR }> {
  return page.evaluate(
    ([loop, drafts, ease]) => {
      const { editor, project, playback, selection } = window.__asg!;
      const keyOf = (label: string) => [...editor.inventory!.nodes.values()].find((node) => node.label === label)!.key;
      const effects = drafts.map((draft, i) => ({
        id: `e${i}`,
        type: draft.type,
        targets: draft.labels.map(keyOf),
        params: draft.params ?? {},
        timing: { start: 0, duration: 1, easing: ease, iterations: 1, direction: 'normal', ...draft.timing },
        ...(draft.pivot && { pivot: draft.pivot }),
        ...(draft.stagger && { stagger: draft.stagger }),
      }));
      // Nothing selected and no effect active, so the overlay draws nothing.
      selection.set([]);
      project.edit((spec) => Object.assign(spec, { duration: 2, loop, effects } as Partial<Spec>));
      project.active = null;
      playback.refresh();
      return { svg: editor.result!.svg, ir: playback.ir! };
    },
    [loop, drafts, EASE_IN_OUT] as const,
  );
}

async function preview(page: Page, t: number): Promise<Buffer> {
  await page.evaluate((s) => window.__asg!.playback.seek(s), t);
  // The overlay sits over the iframe. Hidden for the shot only.
  return page.locator('iframe').screenshot({ style: '[data-testid=canvas] .relative > div { display: none !important; }' });
}

for (const { name, loop = true, effects } of SCENARIOS) {
  test(name, async ({ page, context }, testInfo) => {
    await openEditor(page);
    const { svg, ir } = await load(page, loop, effects);
    expect(ir.notes.filter((note) => note.code === 'missing')).toEqual([]);
    expect(ir.tracks.length).toBeGreaterThan(0);

    const exported = await page.evaluate(([svg, ir]) => window.__asg!.exports.animatedSvg(svg, ir), [svg, ir] as const);
    for (const t of TIMES) {
      // A paused animation with a negative delay shows that moment. Test only: injected after the export check.
      const paused = exported.replace('</style>', `*{animation-play-state:paused!important;animation-delay:${-t}s!important}</style>`);
      const frame = await page.evaluate(
        ([svg, ir, t]) => {
          const { exportMarkup, frameCss, scopeOf } = window.__asg!.exports;
          const scope = scopeOf(svg, ir);
          return exportMarkup(svg, scope, frameCss(ir, t, scope));
        },
        [svg, ir, t] as const,
      );
      const shots = {
        preview: await preview(page, t),
        css: (await render(context, paused, BOX)).png,
        sampler: (await render(context, frame, BOX)).png,
      };
      for (const [a, b] of [['preview', 'css'], ['css', 'sampler']] as const) {
        const result = compare(shots[a], shots[b]);
        const ratio = 'ratio' in result ? result.ratio : 1;
        testInfo.annotations.push({ type: `${a} vs ${b} at ${t}s`, description: `${(ratio * 100).toFixed(3)}%` });
        if (ratio > TOLERANCE) {
          for (const [label, png] of Object.entries(shots)) await testInfo.attach(`${t}s-${label}.png`, { body: png, contentType: 'image/png' });
        }
        expect(ratio, `${a} vs ${b} at ${t}s${'reason' in result ? `: ${result.reason}` : ''}`).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });
}

test('the harness notices a frame that is 50 ms out', async ({ page, context }) => {
  await openEditor(page);
  const { svg, ir } = await load(page, true, SCENARIOS[0].effects);
  const exported = await page.evaluate(([svg, ir]) => window.__asg!.exports.animatedSvg(svg, ir), [svg, ir] as const);
  const late = exported.replace('</style>', '*{animation-play-state:paused!important;animation-delay:-0.67s!important}</style>');
  const result = compare(await preview(page, 0.62), (await render(context, late, BOX)).png);
  expect('ratio' in result && result.ratio).toBeGreaterThan(TOLERANCE * 10);
});

// Inline only. Measured in M4: under emulation, neither engine passes prefers-reduced-motion into an
// SVG shown in <img>, where it always matches no-preference. See docs/ARCHITECTURE.md section 6.
test('reduced motion stops an inline export', async ({ page, browser }) => {
  await openEditor(page);
  const { svg, ir } = await load(page, true, [{ type: 'spin', labels: ['nested'] }]);
  const exports = await page.evaluate(([svg, ir]) => {
    const { animatedSvg, jsSnippet } = window.__asg!.exports;
    return { css: animatedSvg(svg, ir), js: jsSnippet(svg, ir) };
  }, [svg, ir] as const);

  const running = async (reducedMotion: 'reduce' | 'no-preference', markup: string) => {
    const context = await browser.newContext({ reducedMotion });
    const plain = await context.newPage();
    await plain.route('http://plain.test/', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><body>${markup}</body>` }));
    await plain.goto('http://plain.test/');
    const count = await plain.evaluate(() => document.getAnimations().length);
    await context.close();
    return count;
  };
  for (const [name, markup] of Object.entries(exports)) {
    expect(await running('reduce', markup), name).toBe(0);
    // The control: with motion allowed the same export plays.
    expect(await running('no-preference', markup), name).toBe(1);
  }
});

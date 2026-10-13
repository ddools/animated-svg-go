import { expect, test } from '@playwright/test';
import { normalise, openPipeline } from '../helpers/pipeline';

// A file right at the limits: just under 20,000 elements and just under 5 MB.
// Prints the timings that the caps in src/core/parse/limits.ts are tuned against.
test('a file at the caps is processed', async ({ page }, testInfo) => {
  const segment = 'c1.5 2.25 3.5 4.75 5.5 6.25 ';
  const path = (i: number) => `<path id="p${i}" class="c${i % 7}" d="M${i % 900} ${i % 700}${segment.repeat(7)}z"/>`;
  const groups = Array.from({ length: 199 }, (_, g) => `<g id="g${g}">${Array.from({ length: 99 }, (_, i) => path(g * 99 + i)).join('')}</g>`);
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><style>${Array.from({ length: 7 }, (_, c) => `.c${c}{fill:#${c}${c}${c}}`).join('')}</style>${groups.join('')}</svg>`;
  const padded = raw.replace('</svg>', `<!--${'x'.repeat(5 * 1024 * 1024 - raw.length - 64)}--></svg>`);

  await openPipeline(page);
  const out = await normalise(page, padded);
  if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
  const t = out.timings;
  console.log(
    `caps ${testInfo.project.name}: ${(padded.length / 1048576).toFixed(2)} MB, 19,901 elements. ` +
      `optimise ${Math.round(t.optimise)} ms, sanitise ${Math.round(t.sanitise)} ms, rewrite ${Math.round(t.rewrite)} ms`,
  );
  expect(out.svg.match(/data-anim/g)).toHaveLength(19_900);
});

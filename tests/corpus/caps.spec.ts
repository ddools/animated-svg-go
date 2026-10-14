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

// M2's acceptance test: the largest real file in the corpus, from choosing it to seeing it.
test('the largest corpus file loads in the editor', async ({ page }, testInfo) => {
  const { readFileSync } = await import('node:fs');
  const path = new URL('./files/wikimedia/large-blank-world-map-oceans.svg', import.meta.url);
  const buffer = readFileSync(path);
  await page.goto('/editor');
  await page.waitForFunction(() => window.__asg !== undefined);
  const started = Date.now();
  await page.locator('input[type=file]').setInputFiles({ name: 'world-map.svg', mimeType: 'image/svg+xml', buffer });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined, undefined, { polling: 20 });
  const total = Date.now() - started;
  const detail = await page.evaluate(() => {
    const { result, inventory } = window.__asg!.editor;
    return { ...result!.timings, elements: inventory!.nodes.size };
  });
  console.log(
    `load ${testInfo.project.name}: ${(buffer.length / 1048576).toFixed(2)} MB, ${detail.elements} elements, ${total} ms from file chosen to rendered ` +
      `(optimise ${Math.round(detail.optimise)}, sanitise ${Math.round(detail.sanitise)}, rewrite ${Math.round(detail.rewrite)})`,
  );
  expect(detail.elements).toBeGreaterThan(100);
});

// Selection tools measure every shape on first use. Time them on the largest real file.
test('selection tools stay quick on the largest corpus file', async ({ page }, testInfo) => {
  const { readFileSync } = await import('node:fs');
  const buffer = readFileSync(new URL('./files/wikimedia/large-blank-world-map-oceans.svg', import.meta.url));
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'world-map.svg', mimeType: 'image/svg+xml', buffer });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  const [first] = await page.evaluate(() => [...window.__asg!.editor.inventory!.nodes.values()].filter((n) => !n.referenced && n.type === 'path').map((n) => n.key));
  await page.evaluate((key) => window.__asg!.selection.set([key]), first);

  const timed = async (label: string, action: () => Promise<unknown>) => {
    const started = Date.now();
    await action();
    const count = await page.evaluate(() => window.__asg!.selection.keys.size);
    return `${label} ${Date.now() - started} ms (${count} selected)`;
  };
  const tool = (name: string) => page.getByRole('group', { name: 'Select more like this' }).getByRole('button', { name });
  const results = [await timed('same fill', () => tool('Same fill').click()), await timed('same type', () => tool('Same type').click())];

  const frame = (await page.locator('iframe').boundingBox())!;
  results.push(
    await timed('lasso everything', async () => {
      await page.mouse.move(frame.x + 1, frame.y + 1);
      await page.mouse.down();
      await page.mouse.move(frame.x + frame.width - 1, frame.y + frame.height - 1, { steps: 4 });
      await page.mouse.up();
    }),
  );
  console.log(`tools ${testInfo.project.name}: ${results.join(', ')}`);
  expect(await page.evaluate(() => window.__asg!.selection.keys.size)).toBeGreaterThan(100);
});

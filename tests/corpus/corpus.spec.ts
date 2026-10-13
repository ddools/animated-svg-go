import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type BrowserContext } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { normalise, openPipeline } from '../helpers/pipeline';

const here = fileURLToPath(new URL('.', import.meta.url));
const files = (readdirSync(here + 'files', { recursive: true }) as string[]).filter((f) => f.endsWith('.svg')).sort();

// Longest side of every render, in CSS pixels. Small icons are scaled up so a diff means something.
const RENDER_SIZE = 512;

const TOLERANCE = 0.001;

type Shot = { png: Buffer; width: number; height: number };

/**
 * Renders an SVG the way an export is used: as an <img>. `box` forces the layout size,
 * which the normalised file needs because its fixed width and height were removed.
 */
async function render(context: BrowserContext, svg: string, box?: { width: number; height: number }): Promise<Shot> {
  const page = await context.newPage();
  await page.route('http://render.test/**', (route) =>
    route.request().url().endsWith('.svg')
      ? route.fulfill({ contentType: 'image/svg+xml', body: svg })
      : route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#fff"><img id="i" src="/a.svg" style="display:block;transform-origin:0 0">' }),
  );
  await page.goto('http://render.test/');
  const size = await page.evaluate(async (forced) => {
    const img = document.querySelector<HTMLImageElement>('#i')!;
    await img.decode();
    const { width, height } = forced ?? img.getBoundingClientRect();
    // Pin the size in pixels. A file with no intrinsic size would otherwise follow the viewport.
    Object.assign(img.style, { width: `${width}px`, height: `${height}px` });
    return { width, height };
  }, box);
  const scale = RENDER_SIZE / Math.max(size.width, size.height);
  await page.evaluate((s) => (document.querySelector<HTMLElement>('#i')!.style.transform = `scale(${s})`), scale);
  const clip = { x: 0, y: 0, width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
  await page.setViewportSize({ width: Math.max(clip.width, 16), height: Math.max(clip.height, 16) });
  const png = await page.screenshot({ clip });
  await page.close();
  return { png, ...size };
}

function compare(first: Buffer, second: Buffer): { ratio: number; diff: PNG } | { reason: string } {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  if (a.width !== b.width || a.height !== b.height) {
    return { reason: `render size changed from ${a.width}x${a.height} to ${b.width}x${b.height}` };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  return { ratio: differing / (a.width * a.height), diff };
}

for (const file of files) {
  test(file, async ({ page, context }, testInfo) => {
    const engine = testInfo.project.name;
    const out = `${here}report/${engine}/${file.replace(/\.svg$/, '')}`;
    mkdirSync(dirname(out), { recursive: true });
    const record = (result: object) => writeFileSync(`${out}.json`, JSON.stringify({ file, engine, ...result }, null, 2));

    const raw = readFileSync(`${here}files/${file}`, 'utf8');
    await openPipeline(page);
    const result = await normalise(page, raw);
    if (!result.ok) return record({ pass: false, reason: `pipeline refused the file: ${result.code}: ${result.message}` });

    const before = await render(context, raw);
    const after = await render(context, result.svg, { width: before.width, height: before.height });
    const compared = compare(before.png, after.png);
    if ('reason' in compared) return record({ pass: false, reason: compared.reason });
    const { ratio } = compared;
    // Identical means at most 0.1% of pixels differ.
    let pass = ratio <= TOLERANCE;
    let noisePercent: number | undefined;
    if (!pass) {
      // Some engines do not rasterise the same file identically twice (pattern tile seams, blurs).
      // Measure that noise on the original and allow for it, so only real changes fail.
      const again = compare(before.png, (await render(context, raw)).png);
      const noise = 'reason' in again ? 0 : again.ratio;
      noisePercent = +(noise * 100).toFixed(3);
      pass = ratio <= TOLERANCE + noise;
    }
    if (!pass) {
      writeFileSync(`${out}.before.png`, before.png);
      writeFileSync(`${out}.after.png`, after.png);
      writeFileSync(`${out}.diff.png`, PNG.sync.write(compared.diff));
      writeFileSync(`${out}.after.svg`, result.svg);
    }
    record({ pass, diffPercent: +(ratio * 100).toFixed(3), noisePercent, warnings: result.warnings, timings: result.timings });
  });
}

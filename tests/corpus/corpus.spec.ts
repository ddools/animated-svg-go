import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { PNG } from 'pngjs';
import { normalise, openPipeline } from '../helpers/pipeline';
import { compare, render } from '../helpers/render';

const here = fileURLToPath(new URL('.', import.meta.url));
const files = (readdirSync(here + 'files', { recursive: true }) as string[]).filter((f) => f.endsWith('.svg')).sort();

// Share of pixels allowed to differ. WebKit draws hairline seams at pattern tile edges that shift
// with any change to the tree, measured at up to 0.17%. Real regressions seen so far were 3% and up.
const TOLERANCE = 0.0025;

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

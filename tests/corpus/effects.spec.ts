// Smoke test: every effect on every corpus file, through compile and every export. Nothing may throw.
// Results go to report/smoke/<engine>/, which summarise.mjs gates on. Pixel checks are parity's job.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { EFFECTS, newEffect, type EffectType } from '../../src/core/spec/schema';
import { normalise, openPipeline } from '../helpers/pipeline';

const here = fileURLToPath(new URL('.', import.meta.url));
const files = (readdirSync(here + 'files', { recursive: true }) as string[]).filter((f) => f.endsWith('.svg')).sort();
const TYPES = Object.keys(EFFECTS) as EffectType[];

for (const file of files) {
  test(file, async ({ page }, testInfo) => {
    const out = `${here}report/smoke/${testInfo.project.name}/${file.replace(/\.svg$/, '')}.json`;
    mkdirSync(dirname(out), { recursive: true });
    const record = (result: object) => writeFileSync(out, JSON.stringify({ file, engine: testInfo.project.name, ...result }, null, 2));

    const raw = readFileSync(`${here}files/${file}`);
    await openPipeline(page);
    // Files the pipeline refuses never reach the editor. corpus.spec.ts reports those.
    if (!(await normalise(page, raw.toString('utf8'))).ok) return record({ pass: true, skipped: 'refused by the pipeline' });

    await page.locator('input[type=file]').setInputFiles({ name: file, mimeType: 'image/svg+xml', buffer: raw });
    await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
    const roots = await page.evaluate(() => {
      const { inventory } = window.__asg!.editor;
      return inventory!.roots.filter((key) => !inventory!.nodes.get(key)!.referenced);
    });
    // Every effect on the top-level shapes, staggered, so stagger ordering is exercised too.
    const effects = TYPES.map((type) => ({ ...newEffect(type, roots, `e-${type}`), stagger: { gap: 0.05, order: 'random' as const, seed: 7 } }));

    const results = await page.evaluate((effects) => {
      const { editor, project, playback, exports } = window.__asg!;
      return effects.map((effect) => {
        try {
          project.edit((spec) => Object.assign(spec, { duration: 2, loop: true, effects: [effect] }));
          playback.refresh();
          const ir = playback.ir!;
          const svg = editor.result!.svg;
          exports.animatedSvg(svg, ir);
          exports.jsSnippet(svg, ir);
          exports.cssSnippet(svg, ir);
          exports.exportMarkup(svg, exports.scopeOf(svg, ir), exports.frameCss(ir, 0.7, exports.scopeOf(svg, ir)));
          return { type: effect.type, tracks: ir.tracks.length, notes: ir.notes.map((note) => note.code) };
        } catch (error) {
          return { type: effect.type, error: String(error) };
        }
      });
    }, effects);

    const failures = results.filter((r) => 'error' in r);
    record({ pass: !failures.length, targets: roots.length, results });
  });
}

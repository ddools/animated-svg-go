// Turns the per-file results from corpus.spec.ts into report.md and the exit code for `pnpm corpus`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const PASS_RATE = 0.95;
const known = JSON.parse(readFileSync(new URL('known-failures.json', here), 'utf8'));
const expected = readdirSync(new URL('files', here), { recursive: true }).filter((f) => f.endsWith('.svg')).length;

const lines = ['# Corpus report', ''];
const problems = [];
const failed = new Set();

for (const engine of readdirSync(new URL('report', here), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const dir = new URL(`report/${engine}/`, here);
  const results = readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
    .sort((a, b) => a.file.localeCompare(b.file));
  const failures = results.filter((r) => !r.pass);
  const rate = (results.length - failures.length) / results.length;

  lines.push(`## ${engine}: ${results.length - failures.length}/${results.length} identical (${(rate * 100).toFixed(1)}%)`, '');
  if (results.length !== expected) problems.push(`${engine}: ${results.length} results for ${expected} files. Did the run crash?`);
  if (rate < PASS_RATE) problems.push(`${engine}: pass rate ${(rate * 100).toFixed(1)}% is under ${PASS_RATE * 100}%`);

  if (failures.length) lines.push('| File | Result | Explanation |', '| --- | --- | --- |');
  for (const f of failures) {
    failed.add(f.file);
    const what = f.reason ?? `${f.diffPercent}% of pixels differ`;
    lines.push(`| ${f.file} | ${what} | ${known[f.file] ?? '**unexplained**'} |`);
    if (!known[f.file]) problems.push(`${engine}: ${f.file} fails with no entry in known-failures.json (${what})`);
  }
  lines.push('');
}

for (const file of Object.keys(known)) {
  if (!failed.has(file)) problems.push(`${file} is in known-failures.json but passes in every engine. Remove the entry.`);
}

lines.push(problems.length ? '## Gate: FAILED' : '## Gate: passed', '', ...problems.map((p) => `- ${p}`), '');
writeFileSync(new URL('report/report.md', here), lines.join('\n'));
console.log(lines.join('\n'));
process.exit(problems.length ? 1 : 0);

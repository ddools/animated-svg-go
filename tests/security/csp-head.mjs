// Build guard: every page's CSP <meta> must be inside <head>. Any element that doesn't belong in <head>
// closes it early, the <meta> after it lands in <body>, and browsers ignore the policy. It happened once,
// with Vercel Analytics' custom element. CI runs this on a build made with VERCEL=1, so analytics is in it.
// Usage: node tests/security/csp-head.mjs [dist]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HEAD = new Set(['meta', 'title', 'link', 'script', 'style', 'base', 'noscript', 'template']);
const dist = process.argv[2] ?? 'dist';
const pages = readdirSync(dist, { recursive: true }).map(String).filter((path) => path.endsWith('.html'));
const problems = [];

for (const page of pages) {
  const html = readFileSync(join(dist, page), 'utf8');
  const start = html.indexOf('<head>');
  const csp = html.search(/<meta http-equiv="content-security-policy"/i);
  if (start < 0 || csp < 0) {
    problems.push(`${page}: no <head> or no CSP <meta>`);
    continue;
  }
  // Every tag before the policy. <title> text can't hold tags, so a plain scan is enough.
  const before = [...html.slice(start + '<head>'.length, csp).matchAll(/<([a-zA-Z][\w-]*)/g)].map((match) => match[1].toLowerCase());
  const stray = before.filter((tag) => !HEAD.has(tag));
  if (stray.length) problems.push(`${page}: <${stray[0]}> comes before the CSP <meta> and closes <head>`);
}

if (!pages.length) problems.push(`no pages in ${dist}`);
for (const problem of problems) console.error(problem);
console.log(problems.length ? `CSP <meta> outside <head>: ${problems.length} problem(s)` : `CSP <meta> inside <head> on all ${pages.length} pages`);
process.exit(problems.length ? 1 : 0);

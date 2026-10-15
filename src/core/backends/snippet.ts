// The two snippets: markup plus CSS to paste, or markup plus a small WAAPI script. See docs/ARCHITECTURE.md section 5.
import { camel } from '../ir/format';
import { ADDITIVE_PROPERTIES, type IR } from '../ir/types';
import { checkValue, css, exportMarkup, scopeOf, selector } from './css';

/** Inline SVG and the CSS that animates it. The page must keep the data attributes and IDs. */
export function cssSnippet(svg: string, ir: IR): { svg: string; css: string } {
  const scope = scopeOf(svg, ir);
  return { svg: exportMarkup(svg, scope), css: css(ir, scope) };
}

/** Inline SVG and a script that plays it with element.animate(). Nothing plays under reduced motion. */
export function jsSnippet(svg: string, ir: IR): string {
  const scope = scopeOf(svg, ir);
  const tracks = ir.tracks.map((track) => [
    // Relative to the root, which the script finds by its scope.
    selector(scope, track).replace(`[data-asg="${scope}"] `, ''),
    track.keyframes.map(({ offset, value, easing }) => ({ offset, easing: checkValue(easing), [camel(track.property)]: checkValue(value) })),
    ADDITIVE_PROPERTIES.has(track.property) ? 'add' : 'replace',
  ]);
  // JSON is data, and with "<" escaped it cannot close the script element.
  const data = JSON.stringify(tracks).replace(/</g, '\\u003c');
  const timing = `{ duration: ${ir.duration * 1000}, iterations: ${ir.iterations === 'infinite' ? 'Infinity' : 1}, fill: 'both', composite }`;
  const script = `(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.querySelector('[data-asg="${scope}"]');
  for (const [selector, keyframes, composite] of ${data}) root.querySelector(selector)?.animate(keyframes, ${timing});
})();`;
  return `${exportMarkup(svg, scope)}\n<script>\n${script}\n</script>`;
}

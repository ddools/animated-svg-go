import DOMPurify from 'dompurify';
import { PipelineError } from './limits';

// Security-critical. Changes here need the security-reviewer subagent.
// See docs/ARCHITECTURE.md section 2.

const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCAL_REF = /^#/;
const RASTER_DATA = /^data:image\/(png|jpeg|gif|webp);base64,/i;
// The only url() we accept: a same-document reference with nothing odd inside it.
// No whitespace, brackets, quotes or escapes in the fragment, so it cannot hide a second url().
const LOCAL_URL_FN = /url\(\s*(['"]?)#[^\s()'"\\]*\1\s*\)/gi;
// Ways a CSS value can reach the network without a plain url().
const CSS_LOADERS = /image-set|@import|expression|\bsrc\(|\bimage\(/i;
// Editor attributes that carry a human layer name. Stripped by the sanitiser, so read first.
const LABEL_ATTRS = new Set(['inkscape:label', 'serif:id', 'sketch:name']);

const FORBID_TAGS = [
  'foreignObject', 'script', 'style',
  // All SMIL, including the deprecated and helper elements.
  'set', 'animate', 'animateMotion', 'animateTransform', 'animateColor', 'mpath', 'discard',
];

/**
 * 'upload' is for untrusted files. 'export' is the final check on our own output: the same rules,
 * except that it keeps the one <style> css.ts generated, and refuses the export if that style
 * could load anything.
 */
export type Profile = 'upload' | 'export';

export type Sanitised = {
  root: SVGSVGElement;
  /** Layer names from editor-only attributes, read as plain strings before they were stripped. */
  editorLabels: WeakMap<Element, string>;
};

function hrefIsSafe(node: Element, value: string): boolean {
  const href = value.trim();
  if (LOCAL_REF.test(href)) return true;
  // Embedded rasters only, and only on <image>. Never SVG-in-SVG, never on <use> or <a>.
  return node.localName === 'image' && RASTER_DATA.test(href);
}

function cssValueIsSafe(value: string): boolean {
  // A backslash before a bracket is a CSS escape trying to spell url( another way.
  if (value.includes('\\') && value.includes('(')) return false;
  if (CSS_LOADERS.test(value)) return false;
  // Remove every well-formed local url(). Any "url(" left over is remote, unterminated or malformed.
  // Both steps are linear in the length of the value.
  return !/url\(/i.test(value.replace(LOCAL_URL_FN, ''));
}

/** Sanitises an SVG string into an inert DOM tree. The tree is never adopted into the app document. */
export function sanitise(svg: string, profile: Profile = 'upload'): Sanitised {
  const purify = DOMPurify(window);
  const editorLabels = new WeakMap<Element, string>();

  purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (LABEL_ATTRS.has(data.attrName) && data.attrValue) editorLabels.set(node, data.attrValue);
  });

  purify.addHook('afterSanitizeAttributes', (node) => {
    // Under the HTML parser a stray xmlns is a plain attribute. WebKit serialises it as written,
    // and an XML parser would then move the element and its children into that namespace.
    const xmlns = node.getAttribute('xmlns');
    if (xmlns !== null && xmlns !== SVG_NS) node.removeAttribute('xmlns');
    for (const name of ['href', 'xlink:href']) {
      const value = node.getAttribute(name);
      if (value !== null && !hrefIsSafe(node, value)) node.removeAttribute(name);
    }
    for (const attr of Array.from(node.attributes ?? [])) {
      if (attr.name === 'href' || attr.name === 'xlink:href') continue;
      if (!cssValueIsSafe(attr.value)) node.removeAttribute(attr.name);
    }
  });

  const body = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // DOMPurify disallows <use> by default. Real files need it. The href hook above
    // restricts it to same-document references.
    ADD_TAGS: ['use'],
    FORBID_TAGS: profile === 'export' ? FORBID_TAGS.filter((tag) => tag !== 'style') : FORBID_TAGS,
    // DOMPurify drops ids that shadow DOM properties (id="blur", "body", "title"), which breaks
    // real files. The rewrite pass prefixes every id, so no id can collide. `name` has no use in SVG.
    SANITIZE_DOM: false,
    // xml:id is an id by another name and would escape the prefixing.
    FORBID_ATTR: ['name', 'xml:id'],
    RETURN_DOM: true,
  });

  const root = (body as Element).firstElementChild;
  if (!root || root.localName !== 'svg') throw new PipelineError('not-svg', 'No <svg> root element.');
  if (profile === 'export') {
    // Only css.ts writes a <style>, and it writes one, with no "<" in it. Anything else means the export is not ours.
    const styles = root.querySelectorAll('style');
    const text = styles[0]?.textContent ?? '';
    if (styles.length > 1 || text.includes('<') || !cssValueIsSafe(text)) {
      throw new Error('Export refused: unexpected style.');
    }
  }
  return { root: root as SVGSVGElement, editorLabels };
}

import { fnv1a } from './hash';
import { toUserUnits } from './units';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ANIMATABLE = new Set([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use', 'g',
]);
// Content here is referenced, not rendered in place. Stamped, never wrapped.
export const REFERENCED = 'defs, symbol, clipPath, mask, pattern, marker';
// Every ARIA attribute that names IDs. Unprefixed, aria-owns in an inline export could pull a host page element into the drawing (M7 security review).
const ID_LIST_ATTRS = new Set([
  'aria-labelledby', 'aria-describedby', 'aria-owns', 'aria-controls', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto',
]);
// Matches up to and including the "#", so the prefix is inserted and nothing is re-tokenised.
const LOCAL_URL_START = /url\(\s*['"]?#/gi;
// Ours. Authored copies could spoof keys and wrappers, so they are removed before stamping.
const RESERVED_ATTRS = ['data-k', 'data-anim', 'data-for', 'data-asg'];
// On the root these act on the host page's box, not the drawing: pasted inline, a file could
// cover the page (a transform moves and grows the box; Chromium paints a root filter outside the clip).
// SVGO has already moved presentation styles and classes to attributes. A transform on the root
// was ignored in SVG 1.1, so tools rarely write one.
// ponytail: a deny-list, from the M4 security review. An allow-list holds up better as browsers map more SVG 2 attributes to CSS.
const ROOT_BOX_ATTRS = ['style', 'class', 'overflow', 'transform', 'transform-origin', 'filter'];

export type Warning = 'no-size';

/** Rewrites one attribute value so local references point at the namespaced IDs. Pure. */
export function rewriteRefs(name: string, value: string, prefix: string): string {
  if (name === 'id') return prefix + value;
  if (name === 'href' || name === 'xlink:href') return value.startsWith('#') ? `#${prefix}${value.slice(1)}` : value;
  if (ID_LIST_ATTRS.has(name)) {
    return value.split(/\s+/).filter(Boolean).map((id) => prefix + id).join(' ');
  }
  return value.replace(LOCAL_URL_START, (start) => start + prefix);
}

function guaranteeViewBox(root: SVGSVGElement, warnings: Warning[]): void {
  if (!root.hasAttribute('viewBox')) {
    const width = toUserUnits(root.getAttribute('width'));
    const height = toUserUnits(root.getAttribute('height'));
    if (width === null || height === null) warnings.push('no-size');
    // 300 x 150 is the size browsers give a replaced element with no intrinsic size.
    root.setAttribute('viewBox', `0 0 ${width ?? 300} ${height ?? 150}`);
  }
  root.removeAttribute('width');
  root.removeAttribute('height');
}

function namespaceIds(elements: Element[], prefix: string): void {
  for (const element of elements) {
    for (const attr of Array.from(element.attributes)) {
      const next = rewriteRefs(attr.name, attr.value, prefix);
      if (next !== attr.value) attr.value = next;
    }
  }
}

function indexChain(element: Element, root: Element): string {
  const chain: number[] = [];
  for (let node = element; node !== root && node.parentElement; node = node.parentElement) {
    chain.push(Array.prototype.indexOf.call(node.parentElement.children, node));
  }
  return chain.reverse().join('.');
}

/** Stamps data-k on every animatable element. Structural only; M2 adds the geometry fingerprint. */
function stampKeys(elements: Element[], root: Element): Element[] {
  const seen = new Set<string>();
  const stamped: Element[] = [];
  for (const element of elements) {
    if (!ANIMATABLE.has(element.localName)) continue;
    const seed = `${element.localName}:${indexChain(element, root)}`;
    let key = `k${fnv1a(seed)}`;
    for (let salt = 1; seen.has(key); salt++) key = `k${fnv1a(`${seed}#${salt}`)}`;
    seen.add(key);
    element.setAttribute('data-k', key);
    stamped.push(element);
  }
  return stamped;
}

function wrap(stamped: Element[], root: Element): void {
  const doc = root.ownerDocument;
  for (const element of stamped) {
    const parent = element.parentElement;
    if (!parent || element.closest(REFERENCED)) continue;
    // <switch> picks its first direct child that passes the conditional tests.
    // A wrapper would always pass and change which branch renders.
    if (parent.localName === 'switch') continue;
    const wrapper = doc.createElementNS(SVG_NS, 'g');
    wrapper.setAttribute('data-anim', '');
    wrapper.setAttribute('data-for', element.getAttribute('data-k')!);
    parent.insertBefore(wrapper, element);
    wrapper.appendChild(element);
  }
}

function readLabels(stamped: Element[], editorLabels: WeakMap<Element, string>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const element of stamped) {
    const title = Array.prototype.find.call(element.children, (child: Element) => child.localName === 'title');
    const label =
      editorLabels.get(element) ??
      element.getAttribute('data-name') ??
      title?.textContent ??
      element.getAttribute('aria-label') ??
      element.getAttribute('id');
    if (label?.trim()) labels[element.getAttribute('data-k')!] = label.trim();
  }
  return labels;
}

/**
 * Rewrites a sanitised tree in place into the shape the rest of the app relies on:
 * a viewBox, namespaced IDs, a data-k on every animatable element and a wrapper around each.
 */
export function rewrite(
  root: SVGSVGElement,
  editorLabels: WeakMap<Element, string>,
  idPrefix: string,
): { labels: Record<string, string>; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];

  for (const element of elements) {
    for (const name of RESERVED_ATTRS) element.removeAttribute(name);
  }
  for (const name of ROOT_BOX_ATTRS) root.removeAttribute(name);
  guaranteeViewBox(root, warnings);
  // Keys and labels are read before IDs are namespaced and before wrappers shift the tree.
  const stamped = stampKeys(elements.slice(1), root);
  const labels = readLabels(stamped, editorLabels);
  namespaceIds(elements, idPrefix);
  wrap(stamped, root);

  return { labels, warnings };
}

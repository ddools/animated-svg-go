// Security-critical: layer 2. Changes here need the security-reviewer subagent.
// See docs/ARCHITECTURE.md section 2.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Independent of the page CSP the iframe inherits. Style attributes only: no <style>, no stylesheets.
// base-uri and form-action are spelled out because they do not fall back to default-src.
const SANDBOX_CSP =
  "default-src 'none'; style-src-attr 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'";

export type Sandbox = {
  root: SVGSVGElement;
  /** The animatable element under a point, in iframe viewport coordinates. */
  elementAt(x: number, y: number): Element | null;
  elementFor(key: string): Element | undefined;
  destroy(): void;
};

/**
 * Renders SVG markup inside the sandboxed iframe.
 *
 * The markup is parsed as XML into an inert document and imported node by node.
 * It is never parsed as HTML here and never enters the app document.
 * The iframe has no allow-scripts, so nothing inside it can run.
 */
export function mount(iframe: HTMLIFrameElement, svg: string): Sandbox {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('Sandbox iframe has no document.');

  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const source = parsed.documentElement;
  if (source.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Not an SVG document.');

  // SVG only. If the sanitiser ever let an XHTML element through, it would become a live
  // <iframe>, <form> or <img> here, and a named one could shadow properties of the document.
  for (const element of source.querySelectorAll('*')) {
    if (element.namespaceURI !== SVG_NS) element.remove();
  }

  // Links have no job in a preview. Turned into plain groups, they cannot navigate the frame:
  // the page CSP blocks the request, but Chromium still swaps the drawing for an error page.
  for (const link of source.querySelectorAll('a')) {
    const group = parsed.createElementNS(SVG_NS, 'g');
    for (const { name, value } of Array.from(link.attributes)) {
      if (name !== 'href' && name !== 'xlink:href' && name !== 'target') group.setAttribute(name, value);
    }
    group.append(...link.childNodes);
    link.replaceWith(group);
  }

  // The policy goes in before the drawing is imported, so nothing is ever fetched without it.
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = SANDBOX_CSP;
  doc.head.replaceChildren(policy);

  const root = doc.importNode(source, true) as unknown as SVGSVGElement;

  doc.documentElement.style.height = '100%';
  doc.body.style.cssText = 'margin:0;height:100%;overflow:hidden';
  Object.assign(root.style, { display: 'block', width: '100%', height: '100%' });
  doc.body.replaceChildren(root);

  const byKey = new Map<string, Element>();
  for (const element of root.querySelectorAll('[data-k]')) byKey.set(element.getAttribute('data-k')!, element);

  return {
    root,
    elementAt: (x, y) => doc.elementFromPoint(x, y)?.closest('[data-k]') ?? null,
    elementFor: (key) => byKey.get(key),
    destroy: () => doc.body.replaceChildren(),
  };
}

import { fnv1a } from './hash';
import { LIMITS, PipelineError } from './limits';
import type { Optimised } from './optimise';
import { rewrite, type Warning } from './rewrite';
import { sanitise } from './sanitise';

export { LIMITS, PipelineError } from './limits';

export type Normalised = {
  svg: string;
  /** data-k to human layer name. */
  labels: Record<string, string>;
  warnings: (Warning | 'style-dropped')[];
  timings: { optimise: number; sanitise: number; rewrite: number };
};

function enforceTreeLimits(root: Element): void {
  const count = root.querySelectorAll('*').length + 1;
  if (count > LIMITS.elements) {
    throw new PipelineError('too-many-elements', `${count} elements. The limit is ${LIMITS.elements}.`);
  }
  if (expandedSize(root) > LIMITS.expanded) {
    throw new PipelineError('too-many-elements', `More than ${LIMITS.expanded} shapes once every <use> is expanded.`);
  }
  // Leaves are the deepest nodes, so only they need measuring.
  for (const leaf of root.querySelectorAll('*:not(:has(*))')) {
    let depth = 0;
    for (let node: Element | null = leaf; node && node !== root; node = node.parentElement) depth++;
    if (depth > LIMITS.depth) throw new PipelineError('too-deep', `Nested deeper than ${LIMITS.depth} levels.`);
  }
}

/**
 * Element count once every <use> is expanded, capped just past the limit.
 * Iterative, because a chain of <use> can be as long as the element limit.
 */
function expandedSize(root: Element): number {
  const byId = new Map<string, Element>();
  for (const element of root.querySelectorAll('[id]')) {
    if (!byId.has(element.id)) byId.set(element.id, element);
  }
  const target = (element: Element): Element | undefined => {
    if (element.localName !== 'use') return undefined;
    const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
    return href.startsWith('#') ? byId.get(href.slice(1)) : undefined;
  };

  const size = new Map<Element, number>();
  const open = new Set<Element>();
  const stack: Element[] = [root];
  while (stack.length) {
    const element = stack[stack.length - 1];
    if (size.has(element)) {
      stack.pop();
      continue;
    }
    const parts = Array.from(element.children);
    const used = target(element);
    if (used) parts.push(used);
    if (!open.has(element)) {
      open.add(element);
      // A part that is already open is a reference cycle. It renders nothing and counts as zero.
      const pending = parts.filter((part) => !size.has(part) && !open.has(part));
      if (pending.length) {
        stack.push(...pending);
        continue;
      }
    }
    let total = 1;
    for (const part of parts) total += size.get(part) ?? 0;
    size.set(element, Math.min(total, LIMITS.expanded + 1));
    open.delete(element);
    stack.pop();
  }
  return size.get(root)!;
}

/**
 * Untrusted SVG string in, normalised SVG string out.
 * Order matters: nothing but our own rewrite touches the markup after it is sanitised.
 */
export async function normalise(
  raw: string,
  deps: { optimise: (svg: string) => Promise<Optimised> },
): Promise<Normalised> {
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > LIMITS.bytes) throw new PipelineError('too-large', `${bytes} bytes. The limit is ${LIMITS.bytes}.`);

  const t0 = performance.now();
  const optimised = await deps.optimise(raw);
  const t1 = performance.now();
  const { root, editorLabels } = sanitise(optimised.svg);
  enforceTreeLimits(root);
  const t2 = performance.now();
  const { labels, warnings } = rewrite(root, editorLabels, `a${fnv1a(raw)}-`);
  const svg = new XMLSerializer().serializeToString(root);
  const t3 = performance.now();

  return {
    svg,
    labels,
    warnings: optimised.styleDropped ? [...warnings, 'style-dropped'] : warnings,
    timings: { optimise: t1 - t0, sanitise: t2 - t1, rewrite: t3 - t2 },
  };
}

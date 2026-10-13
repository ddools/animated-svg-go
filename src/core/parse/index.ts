import { fnv1a } from './hash';
import { LIMITS, PipelineError } from './limits';
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
  // Leaves are the deepest nodes, so only they need measuring.
  for (const leaf of root.querySelectorAll('*:not(:has(*))')) {
    let depth = 0;
    for (let node: Element | null = leaf; node && node !== root; node = node.parentElement) depth++;
    if (depth > LIMITS.depth) throw new PipelineError('too-deep', `Nested deeper than ${LIMITS.depth} levels.`);
  }
}

/**
 * Untrusted SVG string in, normalised SVG string out.
 * Order matters: nothing but our own rewrite touches the markup after it is sanitised.
 */
export async function normalise(
  raw: string,
  deps: { optimise: (svg: string) => Promise<string> },
): Promise<Normalised> {
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > LIMITS.bytes) throw new PipelineError('too-large', `${bytes} bytes. The limit is ${LIMITS.bytes}.`);

  const t0 = performance.now();
  const optimised = await deps.optimise(raw);
  const t1 = performance.now();
  const { root, editorLabels } = sanitise(optimised);
  enforceTreeLimits(root);
  const t2 = performance.now();
  const { labels, warnings } = rewrite(root, editorLabels, `a${fnv1a(raw).slice(0, 4)}-`);
  const svg = new XMLSerializer().serializeToString(root);
  const t3 = performance.now();

  return {
    svg,
    labels,
    // Whatever SVGO could not inline (media queries, keyframes) went with the <style> element.
    warnings: /<style[\s>]/i.test(optimised) ? [...warnings, 'style-dropped'] : warnings,
    timings: { optimise: t1 - t0, sanitise: t2 - t1, rewrite: t3 - t2 },
  };
}

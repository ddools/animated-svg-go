// What the editor knows about each animatable element. Built from the live, rendered tree,
// because geometry needs layout. Structure is read up front; geometry is measured on first use.

const REFERENCED = 'defs, symbol, clipPath, mask, pattern, marker';

export type InventoryNode = {
  key: string;
  type: string;
  label?: string;
  parent: string | null;
  children: string[];
  /** Inside defs, a clip path, mask, pattern, marker or symbol: drawn by reference, not in place. */
  referenced: boolean;
  hasFilter: boolean;
};

export type Measured = {
  /** In the element's parent coordinate space, padded by half the stroke width (getBBox ignores strokes). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Outline length, for shapes that can be drawn on. */
  length?: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Nothing to see or pivot around. */
  degenerate: boolean;
};

export type Inventory = {
  nodes: Map<string, InventoryNode>;
  roots: string[];
  measure(key: string): Measured | undefined;
};

function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function buildInventory(root: SVGSVGElement, labels: Record<string, string>): Inventory {
  const nodes = new Map<string, InventoryNode>();
  const elements = new Map<string, SVGGraphicsElement>();
  const roots: string[] = [];

  // Document order, so a parent is always registered before its children.
  for (const element of root.querySelectorAll<SVGGraphicsElement>('[data-k]')) {
    const key = element.getAttribute('data-k')!;
    const parent = element.parentElement?.closest('[data-k]')?.getAttribute('data-k') ?? null;
    nodes.set(key, {
      key,
      type: element.localName,
      label: labels[key],
      parent,
      children: [],
      referenced: element.closest(REFERENCED) !== null,
      hasFilter: element.hasAttribute('filter') || element.style.filter !== '',
    });
    elements.set(key, element);
    if (parent) nodes.get(parent)!.children.push(key);
    else roots.push(key);
  }

  const cache = new Map<string, Measured>();
  const view = root.ownerDocument.defaultView!;

  function measure(key: string): Measured | undefined {
    const cached = cache.get(key);
    if (cached) return cached;
    const element = elements.get(key);
    if (!element) return undefined;

    const style = view.getComputedStyle(element);
    const stroke = style.stroke;
    const strokeWidth = stroke === 'none' ? 0 : parseFloat(style.strokeWidth) || 0;
    // The wrapper's box includes the element's own transform, which is the space effects pivot in.
    const wrapper = element.parentElement?.hasAttribute('data-anim') ? (element.parentElement as unknown as SVGGraphicsElement) : element;
    // Firefox throws from both calls for elements that are not rendered (display none, inside defs).
    const box = attempt(() => wrapper.getBBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const pad = strokeWidth / 2;
    const measured: Measured = {
      bbox: { x: box.x - pad, y: box.y - pad, width: box.width + strokeWidth, height: box.height + strokeWidth },
      length: 'getTotalLength' in element ? attempt(() => (element as unknown as SVGGeometryElement).getTotalLength()) : undefined,
      fill: style.fill,
      stroke,
      strokeWidth,
      degenerate: box.width === 0 && box.height === 0,
    };
    cache.set(key, measured);
    return measured;
  }

  return { nodes, roots, measure };
}

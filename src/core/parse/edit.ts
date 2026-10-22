// Replays the spec's structure ops (delete, duplicate, group) over the normalised drawing.
// Our own pass over our own output: it only removes, clones and wraps elements that have
// already been sanitised and rewritten, and writes only keys, wrappers and suffixed IDs.
// See docs/ARCHITECTURE.md section 1. Specs come from storage and agents, so an op that does
// not apply is skipped, never thrown, and the replay stops at the first op that would pass a cap.
import type { StructureOp } from '../spec/schema';
import { fnv1a } from './hash';
import { expandedSize } from './index';
import { LIMITS } from './limits';
import { ID_LIST_ATTRS, REFERENCED } from './rewrite';

const SVG_NS = 'http://www.w3.org/2000/svg';
// The id after a local url(#…) reference, as the rewrite pass left it.
const LOCAL_URL = /(url\(\s*['"]?#)([^'")\s]+)/gi;
// Twice the pipeline's caps: every animatable element has gained a wrapper since they were checked.
const CAPS = { elements: LIMITS.elements * 2, expanded: LIMITS.expanded * 2, depth: LIMITS.depth * 2 };

/** The key a duplicate gives a copy of `key`, or a group gives itself (key 'group'). The editor predicts keys with it. */
export function newKey(seed: number, key: string): string {
  return `k${fnv1a(`${seed}/${key}`)}`;
}

type Drawing = { svg: string; labels: Record<string, string> };

/**
 * The replay's running totals, so each op checks only what it changes, never the whole tree.
 * With a <use> in the drawing, growth can be counted again through it, so expansion is remeasured.
 */
type Budget = { elements: number; expanded: number; uses: boolean };

/** What gets moved, copied or removed for an element: its wrapper, if it has one. */
function outer(element: Element): Element {
  const parent = element.parentElement;
  return parent?.hasAttribute('data-anim') && parent.getAttribute('data-for') === element.getAttribute('data-k') ? parent : element;
}

const sizeOf = (element: Element) => element.getElementsByTagName('*').length + 1;

/** Levels in a subtree, counting itself. */
const height = (element: Element): number => 1 + Array.from(element.children).reduce((most, child) => Math.max(most, height(child)), 0);

/** The op's elements that are still in the drawing, drawn in place, and not inside another of them. In document order. */
function targets(op: StructureOp, byKey: Map<string, Element>, root: Element): Element[] {
  const found = new Set<Element>();
  for (const key of op.keys) {
    const element = byKey.get(key);
    if (element?.isConnected && !element.closest(REFERENCED)) found.add(element);
  }
  if (!found.size) return [];
  // One pass for document order. Sorting by compareDocumentPosition costs a sibling walk per comparison.
  return Array.from(root.querySelectorAll('[data-k]')).filter((element) => {
    if (!found.has(element)) return false;
    for (let node = outer(element).parentElement; node; node = node.parentElement) if (found.has(node)) return false;
    return true;
  });
}

/**
 * Inside a copy, points references to the copy's own IDs at their new names. Everything else is left alone.
 * A suffix, not a prefix: every ID must still start with the document's namespace (invariant 10).
 */
function retarget(name: string, value: string, ids: Set<string>, suffix: string): string {
  const local = (id: string) => (ids.has(id) ? id + suffix : id);
  if (name === 'id') return local(value);
  if (name === 'href' || name === 'xlink:href') return value.startsWith('#') ? `#${local(value.slice(1))}` : value;
  if (ID_LIST_ATTRS.has(name)) return value.split(/\s+/).filter(Boolean).map(local).join(' ');
  return value.replace(LOCAL_URL, (_, start: string, id: string) => start + local(id));
}

/** After an op that grew the drawing by `added` elements: still within the expansion cap? */
function expansionHolds(root: Element, budget: Budget, added: number): boolean {
  budget.expanded = budget.uses ? expandedSize(root, CAPS.expanded) : budget.expanded + added;
  return budget.expanded <= CAPS.expanded;
}

function remove(op: StructureOp, byKey: Map<string, Element>, root: Element, budget: Budget): boolean {
  for (const element of targets(op, byKey, root)) {
    const gone = outer(element);
    budget.elements -= sizeOf(gone);
    if (!budget.uses) budget.expanded -= sizeOf(gone);
    gone.remove();
  }
  return true;
}

/** Each copy goes right after its original. Past a cap, none of them stay. Copies sit at their original's depth. */
function duplicate(op: StructureOp, byKey: Map<string, Element>, labels: Record<string, string>, root: Element, budget: Budget): boolean {
  const made: { copy: Element; stamped: Element[]; keys: Map<string, string> }[] = [];
  const taken = new Set<string>();
  let added = 0;
  const undo = () => made.forEach(({ copy }) => copy.remove());
  for (const element of targets(op, byKey, root)) {
    const source = outer(element);
    // Checked before cloning, so a hostile op never builds what it can't keep.
    added += sizeOf(source);
    if (budget.elements + added > CAPS.elements) return (undo(), false);
    const copy = source.cloneNode(true) as Element;
    const parts = [copy, ...copy.querySelectorAll('*')];
    const stamped = parts.filter((part) => part.hasAttribute('data-k'));
    const keys = new Map(stamped.map((part) => [part.getAttribute('data-k')!, newKey(op.seed, part.getAttribute('data-k')!)]));
    // No salting on a clash, so the editor can predict every key. A clash, here or with another copy in this op, skips this copy.
    if ([...keys.values()].some((key) => byKey.has(key) || taken.has(key))) {
      added -= sizeOf(source);
      continue;
    }
    for (const key of keys.values()) taken.add(key);

    const ids = new Set(parts.map((part) => part.getAttribute('id')).filter((id) => id !== null));
    const suffix = `-c${fnv1a(`${op.seed}/${element.getAttribute('data-k')}`)}`;
    for (const part of parts) {
      for (const attr of Array.from(part.attributes)) {
        const next =
          attr.name === 'data-k' || attr.name === 'data-for' ? (keys.get(attr.value) ?? attr.value) : retarget(attr.name, attr.value, ids, suffix);
        if (next !== attr.value) attr.value = next;
      }
    }
    source.after(copy);
    made.push({ copy, stamped, keys });
  }
  if (!made.length) return true;
  if (!expansionHolds(root, budget, added)) return (undo(), false);
  budget.elements += added;
  for (const { stamped, keys } of made) {
    for (const part of stamped) byKey.set(part.getAttribute('data-k')!, part);
    for (const [from, to] of keys) if (labels[from]) labels[to] = labels[from];
  }
  return true;
}

/** Only siblings that each have a wrapper: moving an element to another parent would change what it inherits. */
function group(op: StructureOp, byKey: Map<string, Element>, root: Element, budget: Budget): boolean {
  const elements = targets(op, byKey, root);
  const outers = elements.map(outer);
  const key = newKey(op.seed, 'group');
  if (!elements.length || byKey.has(key)) return true;
  const parent = outers[0].parentElement!;
  if (outers.some((wrapper, i) => wrapper === elements[i] || wrapper.parentElement !== parent)) return true;

  // The moved layers sink two levels, under the new wrapper and group.
  let depth = 2 + outers.reduce((most, wrapper) => Math.max(most, height(wrapper)), 0);
  for (let node: Element | null = parent; node && node !== root; node = node.parentElement) depth++;
  if (depth > CAPS.depth || budget.elements + 2 > CAPS.elements) return false;

  const doc = root.ownerDocument;
  const wrapper = doc.createElementNS(SVG_NS, 'g');
  wrapper.setAttribute('data-anim', '');
  wrapper.setAttribute('data-for', key);
  const g = doc.createElementNS(SVG_NS, 'g');
  g.setAttribute('data-k', key);
  wrapper.append(g);
  // Where the topmost one was, so the group paints at its level.
  outers.at(-1)!.after(wrapper);
  g.append(...outers);
  if (!expansionHolds(root, budget, 2)) {
    wrapper.replaceWith(...outers);
    return false;
  }
  budget.elements += 2;
  byKey.set(key, g);
  return true;
}

/** The normalised drawing with the ops applied in order. No ops, no parse: the same strings come back. */
export function applyStructure(svg: string, labels: Record<string, string>, ops: StructureOp[]): Drawing {
  if (!ops.length) return { svg, labels };
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) return { svg, labels };

  const byKey = new Map<string, Element>();
  for (const element of root.querySelectorAll('[data-k]')) byKey.set(element.getAttribute('data-k')!, element);
  const budget: Budget = { elements: sizeOf(root), expanded: expandedSize(root, CAPS.expanded), uses: root.querySelector('use') !== null };
  const out = { ...labels };
  for (const op of ops) {
    const applied =
      op.op === 'delete'
        ? remove(op, byKey, root, budget)
        : op.op === 'duplicate'
          ? duplicate(op, byKey, out, root, budget)
          : group(op, byKey, root, budget);
    if (!applied) break;
  }
  return { svg: new XMLSerializer().serializeToString(root), labels: out };
}

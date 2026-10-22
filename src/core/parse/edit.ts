// Replays the spec's structure ops (delete, duplicate, group) over the normalised drawing.
// Our own pass over our own output: it only removes, clones and wraps elements that have
// already been sanitised and rewritten, and writes only keys, wrappers and prefixed IDs.
// See docs/ARCHITECTURE.md section 1. Specs come from storage, so an op that does not apply
// is skipped, never thrown.
import type { StructureOp } from '../spec/schema';
import { fnv1a } from './hash';
import { enforceTreeLimits } from './index';
import { ID_LIST_ATTRS, REFERENCED } from './rewrite';

const SVG_NS = 'http://www.w3.org/2000/svg';
// The id after a local url(#…) reference, as the rewrite pass left it.
const LOCAL_URL = /(url\(\s*['"]?#)([^'")\s]+)/gi;

/** The key a duplicate gives a copy of `key`, or a group gives itself (key 'group'). The editor predicts keys with it. */
export function newKey(seed: number, key: string): string {
  return `k${fnv1a(`${seed}/${key}`)}`;
}

type Drawing = { svg: string; labels: Record<string, string> };

/** What gets moved, copied or removed for an element: its wrapper, if it has one. */
function outer(element: Element): Element {
  const parent = element.parentElement;
  return parent?.hasAttribute('data-anim') && parent.getAttribute('data-for') === element.getAttribute('data-k') ? parent : element;
}

/** The op's elements that are still in the drawing, drawn in place, and not inside another of them. In document order. */
function targets(op: StructureOp, byKey: Map<string, Element>): Element[] {
  const found = new Set<Element>();
  for (const key of op.keys) {
    const element = byKey.get(key);
    if (element?.isConnected && !element.closest(REFERENCED)) found.add(element);
  }
  const top = [...found].filter((element) => {
    for (let node = outer(element).parentElement; node; node = node.parentElement) if (found.has(node)) return false;
    return true;
  });
  return top.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/** Inside a copy, points references to the copy's own IDs at their new names. Everything else is left alone. */
function retarget(name: string, value: string, ids: Set<string>, prefix: string): string {
  const local = (id: string) => (ids.has(id) ? prefix + id : id);
  if (name === 'id') return local(value);
  if (name === 'href' || name === 'xlink:href') return value.startsWith('#') ? `#${local(value.slice(1))}` : value;
  if (ID_LIST_ATTRS.has(name)) return value.split(/\s+/).filter(Boolean).map(local).join(' ');
  return value.replace(LOCAL_URL, (_, start: string, id: string) => start + local(id));
}

/** Within the caps a rewritten tree may reach. Throws otherwise. */
function withinCaps(root: Element): boolean {
  try {
    enforceTreeLimits(root, 2);
    return true;
  } catch {
    return false;
  }
}

function remove(op: StructureOp, byKey: Map<string, Element>) {
  for (const element of targets(op, byKey)) outer(element).remove();
}

/** Each copy goes right after its original. If the copies take the drawing past a cap, none of them stay. */
function duplicate(op: StructureOp, byKey: Map<string, Element>, labels: Record<string, string>, root: Element) {
  const made: { copy: Element; stamped: Element[]; keys: Map<string, string> }[] = [];
  for (const element of targets(op, byKey)) {
    const source = outer(element);
    const copy = source.cloneNode(true) as Element;
    const parts = [copy, ...copy.querySelectorAll('*')];
    const stamped = parts.filter((part) => part.hasAttribute('data-k'));
    const keys = new Map(stamped.map((part) => [part.getAttribute('data-k')!, newKey(op.seed, part.getAttribute('data-k')!)]));
    // No salting on a clash, so the editor can predict every key. A clash skips this copy.
    if ([...keys.values()].some((key) => byKey.has(key))) continue;

    const ids = new Set(parts.map((part) => part.getAttribute('id')).filter((id) => id !== null));
    const prefix = `c${fnv1a(`${op.seed}/${element.getAttribute('data-k')}`)}-`;
    for (const part of parts) {
      for (const attr of Array.from(part.attributes)) {
        const next =
          attr.name === 'data-k' || attr.name === 'data-for' ? (keys.get(attr.value) ?? attr.value) : retarget(attr.name, attr.value, ids, prefix);
        if (next !== attr.value) attr.value = next;
      }
    }
    source.after(copy);
    made.push({ copy, stamped, keys });
  }
  if (!made.length) return;
  if (!withinCaps(root)) return made.forEach(({ copy }) => copy.remove());
  for (const { stamped, keys } of made) {
    for (const part of stamped) byKey.set(part.getAttribute('data-k')!, part);
    for (const [from, to] of keys) if (labels[from]) labels[to] = labels[from];
  }
}

/** Only siblings that each have a wrapper: moving an element to another parent would change what it inherits. */
function group(op: StructureOp, byKey: Map<string, Element>, root: Element) {
  const elements = targets(op, byKey);
  const outers = elements.map(outer);
  const key = newKey(op.seed, 'group');
  if (!elements.length || byKey.has(key)) return;
  if (outers.some((wrapper, i) => wrapper === elements[i] || wrapper.parentElement !== outers[0].parentElement)) return;

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
  if (!withinCaps(root)) {
    wrapper.replaceWith(...outers);
    return;
  }
  byKey.set(key, g);
}

/** The normalised drawing with the ops applied in order. No ops, no parse: the same object comes back. */
export function applyStructure(svg: string, labels: Record<string, string>, ops: StructureOp[]): Drawing {
  if (!ops.length) return { svg, labels };
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) return { svg, labels };

  const byKey = new Map<string, Element>();
  for (const element of root.querySelectorAll('[data-k]')) byKey.set(element.getAttribute('data-k')!, element);
  const out = { ...labels };
  for (const op of ops) {
    if (op.op === 'delete') remove(op, byKey);
    else if (op.op === 'duplicate') duplicate(op, byKey, out, root);
    else group(op, byKey, root);
  }
  return { svg: new XMLSerializer().serializeToString(root), labels: out };
}

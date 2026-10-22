import { newKey } from '../core/parse/edit';
import type { InventoryNode } from '../core/parse/inventory';
import type { Effect, Spec, StructureOp } from '../core/spec/schema';
import { project } from './project.svelte';
import { editor } from './state.svelte';

class Selection {
  keys = $state.raw<ReadonlySet<string>>(new Set());
  hovered = $state<string | null>(null);

  set(keys: Iterable<string>) {
    this.keys = new Set(keys);
  }
  toggle(key: string) {
    const next = new Set(this.keys);
    if (!next.delete(key)) next.add(key);
    this.keys = next;
  }
  add(keys: Iterable<string>) {
    this.keys = new Set([...this.keys, ...keys]);
  }
  clear() {
    this.keys = new Set();
    this.hovered = null;
  }
}

export const selection = new Selection();

/** Layer tree view state. Kept while structure edits remount the drawing; reset for each new file. */
class Tree {
  expanded = $state.raw<ReadonlySet<string>>(new Set());
  /** Hidden in the preview only. Not in the spec, not in exports. */
  hidden = $state.raw<ReadonlySet<string>>(new Set());
  reset() {
    this.expanded = new Set();
    this.hidden = new Set();
  }
}

export const tree = new Tree();

/** Everything drawn in place: not inside defs, clip paths, masks, patterns, markers or symbols. */
export function visibleNodes(): InventoryNode[] {
  return [...(editor.inventory?.nodes.values() ?? [])].filter((node) => !node.referenced);
}

/** A node's children that are drawn in place. */
export function visibleChildren(node: InventoryNode): string[] {
  const nodes = editor.inventory!.nodes;
  return node.children.filter((key) => !nodes.get(key)!.referenced);
}

/** Visible shapes with no visible children: what a click on the canvas can land on. */
export function leafNodes(): InventoryNode[] {
  return visibleNodes().filter((node) => !visibleChildren(node).length);
}

/** Shows an effect's controls and selects what it animates. */
export function chooseEffect(effect: Effect) {
  project.active = effect.id;
  selection.set(effect.targets);
}

function selected(): InventoryNode[] {
  const nodes = editor.inventory!.nodes;
  return [...selection.keys].map((key) => nodes.get(key)).filter((node) => node !== undefined);
}

export function selectSameType() {
  const types = new Set(selected().map((node) => node.type));
  selection.set(visibleNodes().filter((node) => types.has(node.type)).map((node) => node.key));
}

/** Shapes only: a group's computed fill is just what its children inherit. */
export function selectSamePaint(paint: 'fill' | 'stroke') {
  const { measure } = editor.inventory!;
  const values = new Set(selected().map((node) => measure(node.key)?.[paint]));
  const shapes = visibleNodes().filter((node) => node.type !== 'g');
  selection.set(shapes.filter((node) => values.has(measure(node.key)?.[paint])).map((node) => node.key));
}

export function selectSiblings() {
  const parents = new Set(selected().map((node) => node.parent));
  selection.set(visibleNodes().filter((node) => parents.has(node.parent)).map((node) => node.key));
}

export function selectParents() {
  selection.set(selected().map((node) => node.parent ?? node.key));
}

/** Selected layers the edit pass can act on: drawn in place, wrapped, and not inside another selected layer. */
export function editableSelection(): InventoryNode[] {
  const nodes = editor.inventory!.nodes;
  return selected().filter((node) => {
    if (!node.wrapped || node.referenced) return false;
    for (let key = node.parent; key; key = nodes.get(key)!.parent) if (selection.keys.has(key)) return false;
    return true;
  });
}

/** Siblings in the drawing itself, which the inventory's parent can skip past (a link, say). */
export function canGroup(): boolean {
  const nodes = editableSelection();
  const parentOf = (node: InventoryNode) => editor.sandbox?.elementFor(node.key)?.parentElement?.parentElement;
  return nodes.length > 0 && nodes.every((node) => parentOf(node) === parentOf(nodes[0]));
}

function subtree(key: string, out: string[] = []): string[] {
  out.push(key);
  for (const child of editor.inventory!.nodes.get(key)!.children) subtree(child, out);
  return out;
}

/** Adds one structure op, plus any other change, as one undo step. Returns the op's seed. */
function addOp(op: StructureOp['op'], keys: string[], change?: (spec: Spec, seed: number) => void): number {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  project.edit((spec) => {
    spec.structure = [...(spec.structure ?? []), { op, keys, seed }];
    change?.(spec, seed);
  });
  return seed;
}

/** Effects lose the removed layers as targets, and go if they have none left. */
export function deleteSelected() {
  const nodes = editableSelection();
  if (!nodes.length) return;
  const gone = new Set(nodes.flatMap((node) => subtree(node.key)));
  addOp('delete', nodes.map((node) => node.key), (spec) => {
    spec.effects = spec.effects.map((effect) => ({ ...effect, targets: effect.targets.filter((key) => !gone.has(key)) })).filter((effect) => effect.targets.length);
    if (spec.names) for (const key of gone) delete spec.names[key];
  });
  selection.clear();
}

/** Copies go just above their originals, keep their names, and are selected. Effects stay with the originals. */
export function duplicateSelected() {
  const keys = editableSelection().map((node) => node.key);
  if (!keys.length) return;
  const seed = addOp('duplicate', keys, (spec, seed) => {
    const names = spec.names;
    if (names) for (const key of keys.flatMap((key) => subtree(key))) if (names[key]) names[newKey(seed, key)] = names[key];
  });
  selection.set(keys.map((key) => newKey(seed, key)));
}

/** Wraps the selected siblings in a new group, where the topmost one was, and selects it. */
export function groupSelected() {
  if (!canGroup()) return;
  const seed = addOp('group', editableSelection().map((node) => node.key), (spec, seed) => {
    spec.names = { ...spec.names, [newKey(seed, 'group')]: 'Group' };
  });
  selection.set([newKey(seed, 'group')]);
}

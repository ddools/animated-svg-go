import type { InventoryNode } from '../core/parse/inventory';
import type { Effect } from '../core/spec/schema';
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
  return [...selection.keys].map((key) => nodes.get(key)!);
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

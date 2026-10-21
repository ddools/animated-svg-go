import { get } from 'idb-keyval';
import type { InventoryNode } from '../core/parse/inventory';
import { newSpec, SpecSchema, type Effect, type Spec } from '../core/spec/schema';
import { host, SAVE_KEY, type Saved } from './host';

// The spec is the only document state (invariant 5). Undo keeps whole snapshots:
// a spec is a few KB, so structuredClone is cheaper to reason about than patches.
const HISTORY = 100;
const SAVE_DELAY = 500;

class Project {
  spec = $state.raw<Spec>(newSpec());
  /** The effect whose controls are showing. */
  active = $state<string | null>(null);
  past = $state.raw<Spec[]>([]);
  future = $state.raw<Spec[]>([]);
  /** The original file, kept for autosave. Restore runs it through the pipeline again. */
  fileName = '';
  text = '';
  #dragBase: Spec | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  /** One undoable change. */
  edit(change: (spec: Spec) => void) {
    this.settle();
    this.#record(this.spec);
    this.spec = this.#changed(change);
  }

  /** A whole new spec, already validated. One undoable change. */
  replace(spec: Spec) {
    this.settle();
    this.#record(this.spec);
    this.spec = spec;
  }

  /** A change mid-drag. The whole drag becomes one undo step when it settles. */
  drag(change: (spec: Spec) => void) {
    this.#dragBase ??= this.spec;
    this.spec = this.#changed(change);
  }

  settle() {
    if (!this.#dragBase) return;
    this.#record(this.#dragBase);
    this.#dragBase = null;
  }

  undo() {
    this.settle();
    const previous = this.past.at(-1);
    if (!previous) return;
    this.future = [...this.future, this.spec];
    this.past = this.past.slice(0, -1);
    this.spec = previous;
  }

  redo() {
    const next = this.future.at(-1);
    if (!next) return;
    this.past = [...this.past, this.spec];
    this.future = this.future.slice(0, -1);
    this.spec = next;
  }

  /** A new file: a blank spec and no history. */
  open(fileName: string, text: string, spec = newSpec()) {
    this.fileName = fileName;
    this.text = text;
    this.spec = spec;
    this.active = null;
    this.past = [];
    this.future = [];
    this.#dragBase = null;
  }

  /** The effect whose controls are showing, if it still exists. */
  get activeEffect(): Effect | undefined {
    return this.spec.effects.find((effect) => effect.id === this.active);
  }

  /** Changes the active effect. A drag is one undo step, settled on release. */
  editActive(change: (effect: Effect) => void, mode: 'edit' | 'drag' = 'edit') {
    const id = this.active;
    this[mode]((spec) => {
      const effect = spec.effects.find((e) => e.id === id);
      if (effect) change(effect);
    });
  }

  /** What the layer is called: the user's name, then the file's label, then its tag. */
  nameOf(node: InventoryNode): string {
    return this.spec.names?.[node.key] ?? node.label ?? node.type;
  }

  /** Undoable. An empty name, or the file's own, clears the user's. */
  rename(node: InventoryNode, name: string) {
    const trimmed = name.trim().slice(0, 100);
    if (trimmed === this.nameOf(node)) return;
    this.edit((spec) => {
      const names = { ...spec.names };
      if (trimmed && trimmed !== (node.label ?? node.type)) names[node.key] = trimmed;
      else delete names[node.key];
      spec.names = names;
    });
  }

  /** Debounced. Reads the spec now, so an effect that calls it re-runs on every change. */
  save() {
    const saved: Saved = { fileName: this.fileName, text: this.text, spec: this.spec };
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => host.store(saved), SAVE_DELAY);
  }

  #changed(change: (spec: Spec) => void): Spec {
    const next = structuredClone(this.spec);
    change(next);
    return next;
  }

  #record(spec: Spec) {
    this.past = [...this.past.slice(1 - HISTORY), spec];
    this.future = [];
  }
}

export const project = new Project();

/** The last autosaved file, if any. Storage can be blocked, so failure just means nothing saved. */
export async function savedProject(): Promise<{ fileName: string; text: string; spec: Spec | null } | null> {
  try {
    const saved = (await get(SAVE_KEY)) as Saved | undefined;
    if (typeof saved?.text !== 'string' || typeof saved.fileName !== 'string') return null;
    // Storage is not trusted: the text goes back through the whole pipeline, and the spec through the schema.
    const spec = SpecSchema.safeParse(saved.spec);
    return { fileName: saved.fileName, text: saved.text, spec: spec.success ? spec.data : null };
  } catch {
    return null;
  }
}

// The intermediate representation every backend reads (invariant 6). See docs/ARCHITECTURE.md section 3.
import type { Inventory } from '../parse/inventory';

/** Applied to the data-anim wrapper. Everything else is applied to the element itself (invariant 3). */
export const WRAPPER_PROPERTIES = new Set<Property>(['transform', 'opacity']);

/**
 * Composed, not replaced: each effect has its own track, and a target's tracks stack in list order
 * (CSS animation-composition: add, WAAPI composite: 'add'). The wrapper is ours, so there is nothing under them.
 */
export const ADDITIVE_PROPERTIES = new Set<Property>(['transform']);

/** Paint values are always rgb(r, g, b), so they interpolate number by number. */
export type Property = 'transform' | 'opacity' | 'stroke-dashoffset' | 'stroke-dasharray' | 'fill' | 'stroke';

export type Keyframe = {
  /** 0 to 1 across the whole timeline. Non-decreasing; two keyframes at one offset are a jump. */
  offset: number;
  /** CSS-ready. */
  value: string;
  /** Applies from this keyframe to the next. */
  easing: string;
};

export type Track = { target: string; property: Property; keyframes: Keyframe[] };

export type NoteCode =
  | 'missing' // the target is not in this file
  | 'unwrapped' // no wrapper to move, so moving it would overwrite authored attributes
  | 'no-length' // nothing to draw along
  | 'no-stroke' // nothing to draw with
  | 'dashed' // its own dashes are replaced while it draws
  | 'overlap' // a later effect animates the same thing at the same time, and wins. Never for transforms, which stack
  | 'squeezed' // did not fit before the end of the timeline, so it was shortened
  | 'outside'; // starts after the timeline ends

export type Note = { effect: string; code: NoteCode; targets: string[] };

export type IR = {
  /** Seconds. Every track runs for exactly this long. */
  duration: number;
  iterations: 1 | 'infinite';
  tracks: Track[];
  notes: Note[];
};

/** What compile reads from the inventory. A plain object in unit tests. */
export type InventoryView = Pick<Inventory, 'nodes' | 'measure'>;

/** One run of one effect on one target, offsets 0 to 1. compile places it on the timeline. */
export type LocalTrack = { target: string; property: Property; keyframes: { offset: number; value: string }[] };

export type LocalNote = { code: NoteCode; target: string };

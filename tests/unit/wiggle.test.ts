import { describe, expect, it } from 'vitest';
import { compile } from '../../src/core/ir/compile';
import type { InventoryView } from '../../src/core/ir/types';
import type { InventoryNode, Measured } from '../../src/core/parse/inventory';
import { newEffect, newSpec, type Effect } from '../../src/core/spec/schema';

function inventory(...keys: string[]): InventoryView {
  const nodes = new Map<string, InventoryNode>();
  const measured = new Map<string, Measured>();
  for (const key of keys) {
    nodes.set(key, { key, type: 'rect', parent: null, children: [], referenced: false, wrapped: true, hasFilter: false });
    measured.set(key, { bbox: { x: 10, y: 20, width: 40, height: 10 }, length: 40, fill: 'red', stroke: 'black', strokeWidth: 1, dashed: false, degenerate: false });
  }
  return { nodes, measure: (key) => measured.get(key) };
}

function wiggle(params: Record<string, number> = {}, targets = ['a']): Effect {
  const base = newEffect('wiggle', targets, 'w');
  return { ...base, params: { ...base.params, ...params } } as Effect;
}

const run = (effect: Effect, ...keys: string[]) => compile({ ...newSpec(), duration: 1, effects: [effect] }, inventory(...(keys.length ? keys : ['a'])));
const angles = (track: { keyframes: { value: string }[] }) => track.keyframes.map((k) => Number(/rotate\((-?[\d.]+)deg\)/.exec(k.value)![1]));

describe('wiggle', () => {
  it('writes wiggles + 2 evenly spaced keyframes with the pivot baked into each', () => {
    const [track] = run(wiggle({ wiggles: 4 })).tracks;
    expect(track.keyframes.map((k) => k.offset)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    for (const { value } of track.keyframes) expect(value).toMatch(/^translate\(30px, 25px\) rotate\(-?[\d.]+deg\) translate\(-30px, -25px\)$/);
  });

  it('rests at 0 at both ends, then alternates sign within 50 to 100% of the angle', () => {
    const [track] = run(wiggle({ angle: 40, wiggles: 9, seed: 99 })).tracks;
    expect(track.keyframes).toHaveLength(11);
    const a = angles(track);
    expect([a[0], a.at(-1)]).toEqual([0, 0]);
    a.slice(1, -1).forEach((angle, i) => {
      expect(Math.sign(angle)).toBe(i % 2 === 0 ? 1 : -1);
      expect(Math.abs(angle)).toBeGreaterThanOrEqual(20 - 0.001);
      expect(Math.abs(angle)).toBeLessThanOrEqual(40);
    });
  });

  it('repeats for a seed and differs for another', () => {
    const keyframes = (seed: number) => run(wiggle({ seed })).tracks[0].keyframes;
    expect(keyframes(5)).toEqual(keyframes(5));
    expect(keyframes(5)).not.toEqual(keyframes(6));
  });

  it('gives every target the same angles', () => {
    const ir = run(wiggle({}, ['a', 'b']), 'a', 'b');
    expect(angles(ir.tracks[0])).toEqual(angles(ir.tracks[1]));
  });

  it('stacks with a spin on the same target', () => {
    const spin = newEffect('spin', ['a'], 's');
    const ir = compile({ ...newSpec(), effects: [spin, wiggle()] }, inventory('a'));
    expect(ir.tracks.map((t) => [t.target, t.property])).toEqual([['a', 'transform'], ['a', 'transform']]);
    expect(ir.notes).toEqual([]);
  });
});

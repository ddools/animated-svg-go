import { describe, expect, it } from 'vitest';
import { compile } from '../../src/core/ir/compile';
import type { InventoryView } from '../../src/core/ir/types';
import type { InventoryNode, Measured } from '../../src/core/parse/inventory';
import { newEffect, newSpec, type Effect } from '../../src/core/spec/schema';

function inventory(...keys: string[]): InventoryView {
  const nodes = new Map<string, InventoryNode>();
  const measured = new Map<string, Measured>();
  for (const key of keys) {
    nodes.set(key, { key, type: 'rect', parent: null, children: [], referenced: false, wrapped: true, hasFilter: false } as InventoryNode);
    measured.set(key, {
      bbox: { x: 10, y: 20, width: 40, height: 20 },
      length: 40,
      fill: 'red',
      stroke: 'black',
      strokeWidth: 1,
      dashed: false,
      degenerate: false,
    });
  }
  return { nodes, measure: (key) => measured.get(key) };
}

const spec = (effects: Effect[]) => ({ ...newSpec(), effects });

describe('pop', () => {
  it('scales from the start size to 1 about the pivot', () => {
    const effect = { ...newEffect('pop', ['a'], 'p'), pivot: { fx: 0, fy: 1 }, params: { from: 0.25 } } as Effect;
    const ir = compile(spec([effect]), inventory('a'));
    expect(ir.notes).toEqual([]);
    expect(ir.tracks).toHaveLength(1);
    // The 1 s run ends mid-timeline, so the compiler adds a hold frame; only the ends matter here.
    const values = ir.tracks[0].keyframes.map((k) => k.value);
    expect(values[0]).toBe('translate(10px, 40px) scale(0.25) translate(-10px, -40px)');
    expect(values.at(-1)).toBe('translate(10px, 40px) scale(1) translate(-10px, -40px)');
    expect(new Set(values.map((v) => v.replace(/[\d.]+(?=\) translate\(-)/, '')))).toHaveLength(1);
  });

  it('starts from nothing, centred, with a bouncing spring', () => {
    const effect = newEffect('pop', ['a'], 'p');
    expect(effect.params).toEqual({ from: 0 });
    expect(effect.timing.easing).toEqual({ kind: 'spring', bounce: 0.5 });
    const ir = compile(spec([effect]), inventory('a'));
    expect(ir.tracks[0].keyframes[0].value).toBe('translate(30px, 30px) scale(0) translate(-30px, -30px)');
  });

  it('stacks with a spin on the same target', () => {
    const ir = compile(spec([newEffect('spin', ['a'], 's'), newEffect('pop', ['a'], 'p')]), inventory('a'));
    expect(ir.notes).toEqual([]);
    expect(ir.tracks.filter((t) => t.property === 'transform')).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/core/ir/compile';
import type { InventoryView } from '../../src/core/ir/types';
import type { InventoryNode, Measured } from '../../src/core/parse/inventory';
import { newEffect, newSpec, type Effect } from '../../src/core/spec/schema';

const node: InventoryNode = { key: 'a', type: 'rect', parent: null, children: [], referenced: false, wrapped: true, hasFilter: false };
const measured: Measured = { bbox: { x: 0, y: 0, width: 10, height: 10 }, length: 40, fill: 'red', stroke: 'black', dashed: false };
const inventory: InventoryView = { nodes: new Map([['a', node]]), measure: () => measured };

const make = (type: Effect['type'], params?: object) => ({ ...newEffect(type, ['a'], type), ...(params && { params }) }) as Effect;
const run = (...effects: Effect[]) => compile({ ...newSpec(), duration: 4, effects }, inventory);

describe('float', () => {
  it('starts alternating until the end', () => {
    const { timing } = newEffect('float', ['a'], 'f');
    expect(timing.direction).toBe('alternate');
    expect(timing.iterations).toBe('infinite');
  });

  it('moves from nothing to the offset, with the same function list in both frames', () => {
    const once = { ...make('float', { x: 5.5, y: -20 }), timing: { ...newEffect('float', ['a'], 'f').timing, duration: 4, iterations: 1, direction: 'normal' } } as Effect;
    const ir = run(once);
    expect(ir.tracks).toHaveLength(1);
    expect(ir.tracks[0].property).toBe('transform');
    expect(ir.tracks[0].keyframes.map((k) => [k.offset, k.value])).toEqual([
      [0, 'translate(0px, 0px)'],
      [1, 'translate(5.5px, -20px)'],
    ]);
  });

  it('defaults to a 10 unit lift', () => {
    expect(run(make('float')).tracks[0].keyframes[1].value).toBe('translate(0px, -10px)');
  });

  it('stacks with a spin on the same target', () => {
    const ir = run(make('spin'), make('float'));
    expect(ir.tracks.map((t) => t.property)).toEqual(['transform', 'transform']);
    expect(ir.notes).toEqual([]);
  });
});

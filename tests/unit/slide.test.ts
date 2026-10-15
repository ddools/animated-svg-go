import { describe, expect, it } from 'vitest';
import { compile } from '../../src/core/ir/compile';
import type { InventoryView } from '../../src/core/ir/types';
import type { InventoryNode, Measured } from '../../src/core/parse/inventory';
import { EFFECTS, newEffect, newSpec, type Effect } from '../../src/core/spec/schema';

function inventory(key: string): InventoryView {
  const node: InventoryNode = { key, type: 'rect', parent: null, children: [], referenced: false, wrapped: true, hasFilter: false };
  const measured: Measured = {
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    length: 40,
    fill: 'red',
    stroke: 'black',
    dashed: false,
  };
  return { nodes: new Map([[key, node]]), measure: () => measured };
}

function slide(params: Record<string, unknown> = {}): Effect {
  const base = newEffect('slide', ['a'], 'slide');
  return { ...base, params: { ...base.params, ...params } } as Effect;
}

const run = (effects: Effect[]) => compile({ ...newSpec(), duration: 4, effects }, inventory('a'));

describe('slide', () => {
  it('defaults to bottom, 40 units, fading in, with an ease-out', () => {
    expect(EFFECTS.slide.params.parse({})).toEqual({ from: 'bottom', distance: 40, fade: 0 });
    expect(newEffect('slide', ['a'], 's').timing.easing).toEqual({ kind: 'cubic', p: [0, 0, 0.58, 1] });
  });

  it.each([
    ['left', 'translate(-25px, 0px)'],
    ['right', 'translate(25px, 0px)'],
    ['top', 'translate(0px, -25px)'],
    ['bottom', 'translate(0px, 25px)'],
  ])('starts offset %s and ends at rest', (from, start) => {
    const [track] = run([slide({ from, distance: 25 })]).tracks.filter((t) => t.property === 'transform');
    expect(track.keyframes[0].value).toBe(start);
    expect(track.keyframes.at(-1)!.value).toBe('translate(0px, 0px)');
  });

  it('animates opacity only below 1', () => {
    const faded = run([slide({ fade: 0.25 })]).tracks.filter((t) => t.property === 'opacity');
    expect(faded).toHaveLength(1);
    expect([faded[0].keyframes[0].value, faded[0].keyframes.at(-1)!.value]).toEqual(['0.25', '1']);
    expect(run([slide({ fade: 1 })]).tracks.map((t) => t.property)).toEqual(['transform']);
  });

  it('stacks with a spin on the same target', () => {
    const spin = newEffect('spin', ['a'], 'spin');
    const ir = run([spin, slide({ from: 'left' })]);
    expect(ir.tracks.filter((t) => t.property === 'transform')).toHaveLength(2);
    expect(ir.notes).toEqual([]);
  });
});

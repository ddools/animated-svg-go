import { describe, expect, it } from 'vitest';
import { compile } from '../../src/core/ir/compile';
import type { InventoryView } from '../../src/core/ir/types';
import type { InventoryNode, Measured } from '../../src/core/parse/inventory';
import { EFFECTS, newEffect, newSpec, SpecSchema, type Effect, type Spec } from '../../src/core/spec/schema';

type Pulse = Extract<Effect, { type: 'pulse' }>;

/** A wrapped 10 x 20 box at (10, 30) named `a`. */
function inventory(): InventoryView {
  const node = { key: 'a', type: 'rect', parent: null, children: [], referenced: false, wrapped: true, hasFilter: false } as InventoryNode;
  const measured: Measured = {
    bbox: { x: 10, y: 30, width: 10, height: 20 },
    length: 60,
    fill: 'red',
    stroke: 'black',
    dashed: false,
  };
  return { nodes: new Map([['a', node]]), measure: (key) => (key === 'a' ? measured : undefined) };
}

function pulse(params: Partial<Pulse['params']> = {}, duration = 1, pivot?: Effect['pivot']): Pulse {
  const base = newEffect('pulse', ['a'], 'p') as Pulse;
  return { ...base, params: { ...base.params, ...params }, timing: { ...base.timing, duration }, pivot };
}

const spec = (effects: Effect[]): Spec => ({ ...newSpec(), duration: 4, effects });
const frames = (track: { keyframes: { offset: number; value: string }[] }) => track.keyframes.map((k) => [k.offset, k.value]);

describe('pulse', () => {
  it('defaults to infinite iterations and scale 1.15', () => {
    const effect = newEffect('pulse', ['a'], 'p');
    expect(effect.timing.iterations).toBe('infinite');
    expect(effect.params).toEqual({ scale: 1.15, fade: 1 });
  });

  it('grows and returns about the pivot, with one function list throughout', () => {
    const { tracks } = EFFECTS.pulse.compile(pulse({ scale: 1.5 }), inventory());
    expect(tracks).toHaveLength(1);
    expect(tracks[0].property).toBe('transform');
    expect(frames(tracks[0])).toEqual([
      [0, 'translate(15px, 40px) scale(1) translate(-15px, -40px)'],
      [0.5, 'translate(15px, 40px) scale(1.5) translate(-15px, -40px)'],
      [1, 'translate(15px, 40px) scale(1) translate(-15px, -40px)'],
    ]);
  });

  it('bakes an off-centre pivot', () => {
    const { tracks } = EFFECTS.pulse.compile(pulse({}, 1, { fx: 0, fy: 1 }), inventory());
    expect(tracks[0].keyframes[1].value).toBe('translate(10px, 50px) scale(1.15) translate(-10px, -50px)');
  });

  it('writes no opacity track at fade 1, and one below it', () => {
    const none = compile(spec([pulse({ fade: 1 })]), inventory());
    expect(none.tracks.map((t) => t.property)).toEqual(['transform']);
    const dim = compile(spec([pulse({ fade: 0.4 })]), inventory());
    expect(dim.tracks.map((t) => t.property)).toEqual(['transform', 'opacity']);
    // Infinite iterations are expanded to fill the timeline, so check the first run.
    expect(dim.tracks[1].keyframes.slice(0, 3).map((k) => k.value)).toEqual(['1', '0.4', '1']);
  });

  it('refuses a 0.2 s run and accepts 0.4 s', () => {
    expect(SpecSchema.safeParse(spec([pulse({}, 0.2)])).success).toBe(false);
    expect(SpecSchema.safeParse(spec([pulse({}, 0.4)])).success).toBe(true);
  });

  it('stacks with a spin on the same target', () => {
    const ir = compile(spec([newEffect('spin', ['a'], 's'), pulse()]), inventory());
    expect(ir.tracks.map((t) => [t.target, t.property])).toEqual([
      ['a', 'transform'],
      ['a', 'transform'],
    ]);
    expect(ir.notes).toEqual([]);
  });
});

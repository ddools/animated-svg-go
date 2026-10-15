import { describe, expect, it } from 'vitest';
import { compile } from '../../src/core/ir/compile';
import type { InventoryView } from '../../src/core/ir/types';
import type { InventoryNode, Measured } from '../../src/core/parse/inventory';
import { newEffect, newSpec, type Effect } from '../../src/core/spec/schema';

type Fake = Partial<InventoryNode> & Partial<Measured> & { key: string };

/** Shapes as getComputedStyle reports them: colours always rgb() or rgba(). */
function inventory(...fakes: Fake[]): InventoryView {
  const nodes = new Map<string, InventoryNode>();
  const measured = new Map<string, Measured>();
  for (const fake of fakes) {
    nodes.set(fake.key, { type: 'rect', parent: null, children: [], referenced: false, wrapped: true, hasFilter: false, ...fake });
    measured.set(fake.key, {
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      fill: 'rgb(255, 0, 0)',
      stroke: 'none',
      dashed: false,
      ...fake,
    });
  }
  return { nodes, measure: (key) => measured.get(key) };
}

function run(view: InventoryView, targets: string[], params: Partial<Extract<Effect, { type: 'colour' }>['params']> = {}) {
  const effect = newEffect('colour', targets, 'c') as Extract<Effect, { type: 'colour' }>;
  return compile({ ...newSpec(), effects: [{ ...effect, params: { ...effect.params, ...params } }] }, view);
}

describe('colour shift', () => {
  it('runs from the colour in the file to the chosen one, on the element', () => {
    const ir = run(inventory({ key: 'a' }), ['a'], { to: '#0000ff' });
    expect(ir.tracks).toHaveLength(1);
    expect(ir.tracks[0]).toMatchObject({ target: 'a', property: 'fill' });
    expect(ir.tracks[0].keyframes.map((k) => k.value)).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)', 'rgb(0, 0, 255)']);
    expect(ir.notes).toEqual([]);
  });

  it('keeps the file’s alpha on both ends, so only the colour moves', () => {
    const ir = run(inventory({ key: 'a', fill: 'rgba(255, 0, 0, 0.5)' }), ['a'], { to: '#00ff00' });
    expect(ir.tracks[0].keyframes.at(-1)!.value).toBe('rgb(0, 255, 0, 0.5)');
    expect(ir.tracks[0].keyframes[0].value).toBe('rgb(255, 0, 0, 0.5)');
  });

  it('recolours the strokes in a group and skips shapes without one', () => {
    const view = inventory(
      { key: 'g', type: 'g', children: ['line', 'blob'] },
      { key: 'line', parent: 'g', stroke: 'rgb(0, 0, 0)' },
      { key: 'blob', parent: 'g' },
    );
    const ir = run(view, ['g'], { property: 'stroke' });
    expect(ir.tracks.map((t) => [t.target, t.property])).toEqual([['line', 'stroke']]);
    expect(ir.notes).toEqual([]);
  });

  it('notes gradients and shapes with nothing to recolour', () => {
    const view = inventory({ key: 'grad', fill: 'url("#p1-g")' }, { key: 'bare', fill: 'none' });
    const ir = run(view, ['grad', 'bare']);
    expect(ir.tracks).toEqual([]);
    expect(ir.notes).toEqual([
      { effect: 'c', code: 'painted', targets: ['grad'] },
      { effect: 'c', code: 'unpainted', targets: ['bare'] },
    ]);
  });
});

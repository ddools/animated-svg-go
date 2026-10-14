import { describe, expect, it } from 'vitest';
import { compile, easingCss, planRuns } from '../../src/core/ir/compile';
import type { InventoryView } from '../../src/core/ir/types';
import type { InventoryNode, Measured } from '../../src/core/parse/inventory';
import { newEffect, newSpec, type Easing, type Effect, type Spec, type Timing } from '../../src/core/spec/schema';

type Fake = Partial<InventoryNode> & Partial<Measured> & { key: string };

/** A plain inventory: every node a wrapped, stroked 10 x 10 square at the origin unless told otherwise. */
function inventory(...fakes: Fake[]): InventoryView {
  const nodes = new Map<string, InventoryNode>();
  const measured = new Map<string, Measured>();
  for (const fake of fakes) {
    nodes.set(fake.key, { type: 'rect', parent: null, children: [], referenced: false, wrapped: true, hasFilter: false, ...fake });
    measured.set(fake.key, {
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      length: 40,
      fill: 'red',
      stroke: 'black',
      strokeWidth: 1,
      dashed: false,
      degenerate: false,
      ...fake,
    });
  }
  return { nodes, measure: (key) => measured.get(key) };
}

const linear: Easing = { kind: 'cubic', p: [0, 0, 1, 1] };

function effect(type: Effect['type'], targets: string[], timing: Partial<Timing> = {}, extra: Partial<Effect> = {}): Effect {
  const base = newEffect(type, targets, `${type}-${targets.join('-')}-${timing.start ?? 0}`);
  return { ...base, ...extra, timing: { ...base.timing, easing: linear, ...timing } } as Effect;
}

function spec(effects: Effect[], patch: Partial<Spec> = {}): Spec {
  return { ...newSpec(), duration: 4, effects, ...patch };
}

/** [offset, value] pairs for a quick read. */
const frames = (track: { keyframes: { offset: number; value: string }[] }) => track.keyframes.map((k) => [k.offset, k.value]);

describe('easingCss', () => {
  it('writes cubic-bezier and steps', () => {
    expect(easingCss({ kind: 'cubic', p: [0.42, 0, 0.58, 1] })).toBe('cubic-bezier(0.42, 0, 0.58, 1)');
    expect(easingCss({ kind: 'steps', n: 4, pos: 'end' })).toBe('steps(4, end)');
  });

  it('mirrors for a reversed run, as CSS does', () => {
    expect(easingCss({ kind: 'cubic', p: [0.1, 0.2, 0.3, 0.4] }, true)).toBe('cubic-bezier(0.7, 0.6, 0.9, 0.8)');
    expect(easingCss({ kind: 'steps', n: 3, pos: 'start' }, true)).toBe('steps(3, end)');
  });
});

describe('planRuns', () => {
  const timing: Timing = { start: 1, duration: 1, easing: linear, iterations: 2, direction: 'alternate' };

  it('places whole runs and reverses alternate ones', () => {
    expect(planRuns(timing, 4)).toEqual({
      runs: [
        { start: 1, end: 2, reversed: false },
        { start: 2, end: 3, reversed: true },
      ],
    });
  });

  it('fills the rest of the timeline with whole runs when infinite', () => {
    expect(planRuns({ ...timing, start: 0, duration: 0.3, iterations: 'infinite' }, 1).runs).toHaveLength(3);
    // 0.1 into 0.3 is 2.9999… in floating point. Still three runs.
    expect(planRuns({ ...timing, start: 0, duration: 0.1, iterations: 'infinite' }, 0.3).runs).toHaveLength(3);
  });

  it('drops runs that do not fit, and squeezes a single run that does not', () => {
    expect(planRuns({ ...timing, iterations: 5 }, 4)).toMatchObject({ code: 'squeezed', runs: { length: 3 } });
    expect(planRuns({ ...timing, duration: 5, iterations: 1 }, 4)).toEqual({
      code: 'squeezed',
      runs: [{ start: 1, end: 4, reversed: false }],
    });
    expect(planRuns({ ...timing, start: 4 }, 4)).toEqual({ runs: [], code: 'outside' });
  });
});

describe('compile', () => {
  it('spans the whole timeline, holding before and after the effect', () => {
    const ir = compile(spec([effect('draw', ['a'], { start: 1, duration: 2 })]), inventory({ key: 'a' }));
    expect(ir).toMatchObject({ duration: 4, iterations: 'infinite' });
    const offset = ir.tracks.find((t) => t.property === 'stroke-dashoffset')!;
    expect(frames(offset)).toEqual([
      [0, '40'],
      [0.25, '40'],
      [0.75, '0'],
      [1, '0'],
    ]);
    expect(offset.keyframes.map((k) => k.easing)).toEqual(['linear', 'cubic-bezier(0, 0, 1, 1)', 'linear', 'linear']);
  });

  it('plays once when the timeline does not loop', () => {
    expect(compile(spec([], { loop: false }), inventory()).iterations).toBe(1);
  });

  it('jumps back between normal runs and folds the turnaround of alternate ones', () => {
    const normal = compile(spec([effect('draw', ['a'], { duration: 2, iterations: 2 })]), inventory({ key: 'a' }));
    expect(frames(normal.tracks[1])).toEqual([
      [0, '40'],
      [0.5, '0'],
      [0.5, '40'],
      [1, '0'],
    ]);
    const alternate = compile(spec([effect('draw', ['a'], { duration: 2, iterations: 2, direction: 'alternate' })]), inventory({ key: 'a' }));
    expect(frames(alternate.tracks[1])).toEqual([
      [0, '40'],
      [0.5, '0'],
      [1, '40'],
    ]);
  });

  it('puts the mirrored easing on reversed runs', () => {
    const ir = compile(
      spec([effect('draw', ['a'], { duration: 4, direction: 'reverse', easing: { kind: 'cubic', p: [0.1, 0.2, 0.3, 0.4] } })]),
      inventory({ key: 'a' }),
    );
    expect(ir.tracks[1].keyframes).toEqual([
      { offset: 0, value: '0', easing: 'cubic-bezier(0.7, 0.6, 0.9, 0.8)' },
      { offset: 1, value: '40', easing: 'linear' },
    ]);
  });

  it('merges effects on the same target and property, holding between them', () => {
    const ir = compile(
      spec([
        effect('draw', ['a'], { start: 0, duration: 1 }, { params: { from: 0, to: 50 } }),
        effect('draw', ['a'], { start: 2, duration: 1 }, { params: { from: 100, to: 0 } }),
      ]),
      inventory({ key: 'a' }),
    );
    const offset = ir.tracks.find((t) => t.property === 'stroke-dashoffset')!;
    expect(frames(offset)).toEqual([
      [0, '40'],
      [0.25, '20'],
      [0.5, '20'],
      [0.5, '0'],
      [0.75, '40'],
      [1, '40'],
    ]);
    expect(ir.tracks).toHaveLength(2);
    expect(ir.notes).toEqual([]);
  });

  it('lets the later effect win where two overlap, and says so', () => {
    const first = effect('draw', ['a'], { start: 0, duration: 2 });
    const second = effect('draw', ['a'], { start: 1, duration: 2 }, { params: { from: 50, to: 100 } });
    const ir = compile(spec([first, second]), inventory({ key: 'a' }));
    expect(frames(ir.tracks[1])[0]).toEqual([0, '20']);
    expect(ir.notes).toEqual([{ effect: first.id, code: 'overlap', targets: ['a'] }]);
    // Order in the list decides, not order in time.
    const swapped = compile(spec([second, first]), inventory({ key: 'a' }));
    expect(swapped.notes).toEqual([{ effect: second.id, code: 'overlap', targets: ['a'] }]);
  });

  it('notes missing targets and refuses to move what has no wrapper', () => {
    const spin = effect('spin', ['gone', 'loose', 'ok']);
    const ir = compile(spec([spin]), inventory({ key: 'loose', wrapped: false }, { key: 'ok' }));
    expect(ir.tracks.map((t) => t.target)).toEqual(['ok']);
    expect(ir.notes).toEqual([
      { effect: spin.id, code: 'missing', targets: ['gone'] },
      { effect: spin.id, code: 'unwrapped', targets: ['loose'] },
    ]);
  });

  it('notes an effect that starts after the end', () => {
    const late = effect('spin', ['a'], { start: 5 });
    const ir = compile(spec([late]), inventory({ key: 'a' }));
    expect(ir.tracks).toEqual([]);
    expect(ir.notes).toEqual([{ effect: late.id, code: 'outside', targets: ['a'] }]);
  });
});

describe('spin', () => {
  it('bakes the pivot into the same function list in every keyframe', () => {
    const view = inventory({ key: 'a', bbox: { x: 10, y: 20, width: 40, height: 10 } });
    const ir = compile(spec([effect('spin', ['a'], { duration: 4 }, { pivot: { fx: 0.25, fy: 1 } })]), view);
    expect(frames(ir.tracks[0])).toEqual([
      [0, 'translate(20px, 30px) rotate(0deg) translate(-20px, -30px)'],
      [1, 'translate(20px, 30px) rotate(360deg) translate(-20px, -30px)'],
    ]);
  });

  it('defaults to the centre of each target', () => {
    const view = inventory({ key: 'a', bbox: { x: 0, y: 0, width: 2, height: 4 } }, { key: 'b', bbox: { x: 10, y: 10, width: 10, height: 10 } });
    const ir = compile(spec([effect('spin', ['a', 'b'])]), view);
    expect(ir.tracks.map((t) => t.keyframes[0].value)).toEqual([
      'translate(1px, 2px) rotate(0deg) translate(-1px, -2px)',
      'translate(15px, 15px) rotate(0deg) translate(-15px, -15px)',
    ]);
  });
});

describe('draw', () => {
  it('holds a dash pattern with a gap twice the length', () => {
    const ir = compile(spec([effect('draw', ['a'])]), inventory({ key: 'a', length: 12.3456 }));
    expect(ir.tracks[0].property).toBe('stroke-dasharray');
    expect(new Set(ir.tracks[0].keyframes.map((k) => k.value))).toEqual(new Set(['12.346 24.691']));
  });

  it('draws every shape inside a group, skipping what is drawn by reference', () => {
    const view = inventory(
      { key: 'g', type: 'g', children: ['a', 'defs-child', 'inner'], length: undefined },
      { key: 'a' },
      { key: 'defs-child', referenced: true },
      { key: 'inner', type: 'g', children: ['b'], length: undefined },
      { key: 'b', length: 8 },
    );
    const ir = compile(spec([effect('draw', ['g'])]), view);
    expect([...new Set(ir.tracks.map((t) => t.target))]).toEqual(['a', 'b']);
  });

  it('notes shapes it cannot draw, and dashes it replaces', () => {
    const draw = effect('draw', ['text', 'filled', 'dashed']);
    const view = inventory({ key: 'text', type: 'text', length: undefined }, { key: 'filled', stroke: 'none' }, { key: 'dashed', dashed: true });
    const ir = compile(spec([draw]), view);
    expect(ir.notes).toEqual([
      { effect: draw.id, code: 'no-length', targets: ['text'] },
      { effect: draw.id, code: 'no-stroke', targets: ['filled'] },
      { effect: draw.id, code: 'dashed', targets: ['dashed'] },
    ]);
    expect([...new Set(ir.tracks.map((t) => t.target))]).toEqual(['dashed']);
  });
});

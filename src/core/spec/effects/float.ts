// A translate has no pivot, so nothing to bake. Moves the wrapper (invariant 3).
import { z } from 'zod';
import { num } from '../../ir/format';
import type { EffectModule } from '../schema';

const offset = z.number().min(-200).max(200);

export const FloatParams = z.object({
  x: offset.default(0),
  y: offset.default(-10),
});

export const float: EffectModule<'float'> = {
  type: 'float',
  label: 'Float',
  params: FloatParams,
  ui: [
    { kind: 'range', key: 'x', label: 'Across', min: -200, max: 200, step: 1, unit: '' },
    { kind: 'range', key: 'y', label: 'Up and down', min: -200, max: 200, step: 1, unit: '' },
  ],
  pivot: false,
  timing: { direction: 'alternate', iterations: 'infinite' },
  compile({ targets, params }) {
    const tracks = targets.map((target) => ({
      target,
      property: 'transform' as const,
      keyframes: [
        { offset: 0, value: 'translate(0px, 0px)' },
        { offset: 1, value: `translate(${num(params.x)}px, ${num(params.y)}px)` },
      ],
    }));
    return { tracks, notes: [] };
  },
};

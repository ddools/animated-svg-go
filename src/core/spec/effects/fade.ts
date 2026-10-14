// Opacity is a wrapper property like transform (invariant 3), but it has no pivot to bake.
import { z } from '../zod';
import { num } from '../../ir/format';
import type { EffectModule } from '../schema';

const level = z.number().min(0).max(1);

export const FadeParams = z.object({
  from: level.default(0),
  to: level.default(1),
});

export const fade: EffectModule<'fade'> = {
  type: 'fade',
  label: 'Fade',
  params: FadeParams,
  ui: [
    { kind: 'range', key: 'from', label: 'From', min: 0, max: 1, step: 0.05, unit: '' },
    { kind: 'range', key: 'to', label: 'To', min: 0, max: 1, step: 0.05, unit: '' },
  ],
  pivot: false,
  compile({ targets, params }) {
    const tracks = targets.map((target) => ({
      target,
      property: 'opacity' as const,
      keyframes: [
        { offset: 0, value: num(params.from) },
        { offset: 1, value: num(params.to) },
      ],
    }));
    return { tracks, notes: [] };
  },
};

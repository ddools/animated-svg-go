// Scales the wrapper up to full size about a pivot baked into every keyframe (invariant 4). The overshoot comes from the spring easing.
import { z } from '../zod';
import { num } from '../../ir/format';
import type { EffectModule } from '../schema';
import { around } from './spin';

export const PopParams = z.object({
  from: z.number().min(0).max(1).default(0),
});

export const pop: EffectModule<'pop'> = {
  type: 'pop',
  label: 'Pop',
  params: PopParams,
  ui: [{ kind: 'range', key: 'from', label: 'Start size', min: 0, max: 1, step: 0.05, unit: '' }],
  pivot: true,
  timing: { easing: { kind: 'spring', bounce: 0.5 } },
  compile({ targets, params, pivot }, inventory) {
    const tracks = targets.map((target) => {
      const about = around(target, pivot, inventory);
      const at = (scale: number) => about(`scale(${num(scale)})`);
      return {
        target,
        property: 'transform' as const,
        keyframes: [
          { offset: 0, value: at(params.from) },
          { offset: 1, value: at(1) },
        ],
      };
    });
    return { tracks, notes: [] };
  },
};

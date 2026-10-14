// The pattern for transform effects: they move the wrapper, about a pivot baked into every keyframe (invariant 4).
import { z } from 'zod';
import { num } from '../../ir/format';
import type { EffectModule } from '../schema';

export const SpinParams = z.object({
  degrees: z.number().min(-1080).max(1080).default(360),
});

export const spin: EffectModule<'spin'> = {
  type: 'spin',
  label: 'Spin',
  params: SpinParams,
  ui: [{ key: 'degrees', label: 'Angle', min: -1080, max: 1080, step: 15, unit: '°' }],
  transform: true,
  compile({ targets, params, pivot = { fx: 0.5, fy: 0.5 } }, inventory) {
    const tracks = targets.map((target) => {
      const box = inventory.measure(target)?.bbox ?? { x: 0, y: 0, width: 0, height: 0 };
      const [x, y] = [box.x + pivot.fx * box.width, box.y + pivot.fy * box.height];
      // Same function list in every keyframe, so the browser interpolates the angle alone.
      const at = (angle: number) =>
        `translate(${num(x)}px, ${num(y)}px) rotate(${num(angle)}deg) translate(${num(-x)}px, ${num(-y)}px)`;
      return {
        target,
        property: 'transform' as const,
        keyframes: [
          { offset: 0, value: at(0) },
          { offset: 1, value: at(params.degrees) },
        ],
      };
    });
    return { tracks, notes: [] };
  },
};

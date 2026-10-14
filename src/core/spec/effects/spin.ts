// The pattern for transform effects: they move the wrapper, about a pivot baked into every keyframe (invariant 4).
import { z } from 'zod';
import { num } from '../../ir/format';
import type { InventoryView } from '../../ir/types';
import type { Effect, EffectModule } from '../schema';

export const SpinParams = z.object({
  degrees: z.number().min(-1080).max(1080).default(360),
});

/**
 * Wraps one transform function in translations to and from the pivot, so it acts about that point.
 * Every effect with a pivot uses this, so all their keyframes share one function-list shape.
 */
export function around(target: string, pivot: Effect['pivot'] = { fx: 0.5, fy: 0.5 }, inventory: InventoryView): (op: string) => string {
  const box = inventory.measure(target)?.bbox ?? { x: 0, y: 0, width: 0, height: 0 };
  const [x, y] = [box.x + pivot.fx * box.width, box.y + pivot.fy * box.height];
  return (op) => `translate(${num(x)}px, ${num(y)}px) ${op} translate(${num(-x)}px, ${num(-y)}px)`;
}

export const spin: EffectModule<'spin'> = {
  type: 'spin',
  label: 'Spin',
  params: SpinParams,
  ui: [{ kind: 'range', key: 'degrees', label: 'Angle', min: -1080, max: 1080, step: 15, unit: '°' }],
  pivot: true,
  compile({ targets, params, pivot }, inventory) {
    const tracks = targets.map((target) => {
      // Same function list in every keyframe, so the browser interpolates the angle alone.
      const about = around(target, pivot, inventory);
      const at = (angle: number) => about(`rotate(${num(angle)}deg)`);
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

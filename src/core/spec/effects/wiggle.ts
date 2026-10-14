// Rocks the wrapper about the pivot. Same swings every time for a seed; stagger gives targets their variety.
import { z } from 'zod';
import { num, random } from '../../ir/format';
import type { EffectModule } from '../schema';

export const WiggleParams = z.object({
  angle: z.number().min(1).max(90).default(10),
  wiggles: z.int().min(1).max(20).default(4),
  /** Set by the Shuffle button, so it has no slider. */
  seed: z.int().min(0).max(2 ** 32 - 1).default(1),
});

export const wiggle: EffectModule<'wiggle'> = {
  type: 'wiggle',
  label: 'Wiggle',
  params: WiggleParams,
  ui: [
    { kind: 'range', key: 'angle', label: 'Angle', min: 1, max: 90, step: 1, unit: '°' },
    { kind: 'range', key: 'wiggles', label: 'Wiggles', min: 1, max: 20, step: 1, unit: '' },
  ],
  pivot: true,
  compile({ targets, params, pivot = { fx: 0.5, fy: 0.5 } }, inventory) {
    const next = random(params.seed);
    // Rest, then alternating swings of 50 to 100% of the angle, then rest.
    const angles = [0, ...Array.from({ length: params.wiggles }, (_, i) => params.angle * (0.5 + 0.5 * next()) * (i % 2 === 0 ? 1 : -1)), 0];
    const tracks = targets.map((target) => {
      const box = inventory.measure(target)?.bbox ?? { x: 0, y: 0, width: 0, height: 0 };
      const [x, y] = [box.x + pivot.fx * box.width, box.y + pivot.fy * box.height];
      return {
        target,
        property: 'transform' as const,
        keyframes: angles.map((angle, i) => ({
          offset: i / (angles.length - 1),
          value: `translate(${num(x)}px, ${num(y)}px) rotate(${num(angle)}deg) translate(${num(-x)}px, ${num(-y)}px)`,
        })),
      };
    });
    return { tracks, notes: [] };
  },
};

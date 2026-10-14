// One pulse per run: grow about a pivot to a peak and back, optionally dimming at the peak.
import { z } from 'zod';
import { num } from '../../ir/format';
import type { LocalTrack } from '../../ir/types';
import type { EffectModule } from '../schema';

export const PulseParams = z.object({
  scale: z.number().min(1).max(2).default(1.15),
  fade: z.number().min(0).max(1).default(1),
});
export type PulseParams = z.infer<typeof PulseParams>;

const OFFSETS = [0, 0.5, 1];

export const pulse: EffectModule<'pulse'> = {
  type: 'pulse',
  label: 'Pulse',
  params: PulseParams,
  ui: [
    { kind: 'range', key: 'scale', label: 'Size', min: 1, max: 2, step: 0.05, unit: '' },
    { kind: 'range', key: 'fade', label: 'Opacity at peak', min: 0, max: 1, step: 0.05, unit: '' },
  ],
  pivot: true,
  timing: { iterations: 'infinite' },
  // No more than three pulses a second (WCAG 2.3.1).
  minDuration: 1 / 3,
  compile({ targets, params, pivot = { fx: 0.5, fy: 0.5 } }, inventory) {
    const tracks = targets.flatMap((target): LocalTrack[] => {
      const box = inventory.measure(target)?.bbox ?? { x: 0, y: 0, width: 0, height: 0 };
      const [x, y] = [box.x + pivot.fx * box.width, box.y + pivot.fy * box.height];
      const at = (s: number) => `translate(${num(x)}px, ${num(y)}px) scale(${num(s)}) translate(${num(-x)}px, ${num(-y)}px)`;
      const track = (property: LocalTrack['property'], values: string[]): LocalTrack => ({
        target,
        property,
        keyframes: values.map((value, i) => ({ offset: OFFSETS[i], value })),
      });
      return [
        track('transform', [1, params.scale, 1].map(at)),
        // A constant opacity track would fight a Fade on the same shape.
        ...(params.fade < 1 ? [track('opacity', ['1', num(params.fade), '1'])] : []),
      ];
    });
    return { tracks, notes: [] };
  },
};

// Moves the wrapper in from one side, ending where it was authored. No pivot: a translate has none to bake.
import { z } from '../zod';
import { num } from '../../ir/format';
import type { EffectModule } from '../schema';

export const SlideParams = z.object({
  from: z.enum(['left', 'right', 'top', 'bottom']).default('bottom'),
  /** Drawing units. */
  distance: z.number().min(1).max(500).default(40),
  /** Opacity at the start. 1 leaves opacity alone. */
  fade: z.number().min(0).max(1).default(0),
});

export const slide: EffectModule<'slide'> = {
  type: 'slide',
  label: 'Slide in',
  params: SlideParams,
  ui: [
    {
      kind: 'select',
      key: 'from',
      label: 'From',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ],
    },
    { kind: 'range', key: 'distance', label: 'Distance', min: 1, max: 500, step: 1, unit: '' },
    { kind: 'range', key: 'fade', label: 'Start opacity', min: 0, max: 1, step: 0.05, unit: '' },
  ],
  pivot: false,
  timing: { easing: { kind: 'cubic', p: [0, 0, 0.58, 1] } },
  compile({ targets, params }) {
    const d = params.distance;
    const [dx, dy] = { left: [-d, 0], right: [d, 0], top: [0, -d], bottom: [0, d] }[params.from];
    const tracks = targets.flatMap((target) => [
      {
        target,
        property: 'transform' as const,
        keyframes: [
          { offset: 0, value: `translate(${num(dx)}px, ${num(dy)}px)` },
          { offset: 1, value: 'translate(0px, 0px)' },
        ],
      },
      ...(params.fade < 1
        ? [
            {
              target,
              property: 'opacity' as const,
              keyframes: [
                { offset: 0, value: num(params.fade) },
                { offset: 1, value: '1' },
              ],
            },
          ]
        : []),
    ]);
    return { tracks, notes: [] };
  },
};

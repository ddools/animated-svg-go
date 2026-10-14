// Paint is styled on the element itself, like Draw. Runs from each shape's own colour in the file to one chosen colour.
import { z } from '../zod';
import { num } from '../../ir/format';
import type { LocalNote, LocalTrack } from '../../ir/types';
import type { EffectModule } from '../schema';
import { shapesOf } from './draw';

export const ColourParams = z.object({
  property: z.enum(['fill', 'stroke']).default('fill'),
  to: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#e11d48'),
});

/** Channels of a computed colour, or undefined for a gradient, pattern or anything else we can't read. */
function channels(computed: string): number[] | undefined {
  const match = /^rgba?\(([^)]*)\)$/.exec(computed.trim());
  if (!match) return undefined;
  const values = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (values.length < 3 || values.length > 4 || values.some((v) => !Number.isFinite(v))) return undefined;
  return values;
}

export const colour: EffectModule<'colour'> = {
  type: 'colour',
  label: 'Colour shift',
  params: ColourParams,
  ui: [
    {
      kind: 'select',
      key: 'property',
      label: 'Paint',
      options: [
        { value: 'fill', label: 'Fill' },
        { value: 'stroke', label: 'Stroke' },
      ],
    },
    { kind: 'colour', key: 'to', label: 'To' },
  ],
  pivot: false,
  compile({ targets, params }, inventory) {
    const tracks: LocalTrack[] = [];
    const notes: LocalNote[] = [];
    const to = [1, 3, 5].map((i) => parseInt(params.to.slice(i, i + 2), 16));
    for (const target of targets) {
      let [painted, unreadable] = [0, 0];
      for (const shape of shapesOf(target, inventory)) {
        const paint = inventory.measure(shape)?.[params.property];
        // Inside a group, shapes without this paint are just skipped: a group of strokes has no fills.
        if (!paint || paint === 'none') continue;
        const from = channels(paint);
        if (!from) {
          notes.push({ code: 'painted', target: shape });
          unreadable++;
          continue;
        }
        // The file's alpha carries over to the new colour, so only the colour moves. Interpolating
        // alpha as well would be premultiplied in browsers, not number by number as the sampler does.
        const alpha = from[3] ?? 1;
        const css = ([r, g, b]: number[]) => `rgb(${[r, g, b, ...(alpha < 1 ? [alpha] : [])].map(num).join(', ')})`;
        tracks.push({
          target: shape,
          property: params.property,
          keyframes: [
            { offset: 0, value: css(from) },
            { offset: 1, value: css(to) },
          ],
        });
        painted++;
      }
      if (!painted && !unreadable) notes.push({ code: 'unpainted', target });
    }
    return { tracks, notes };
  },
};

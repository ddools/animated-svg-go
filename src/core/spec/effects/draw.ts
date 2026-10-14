// The pattern for paint and dash effects: they style the element itself, whose own attributes beat the wrapper's.
import { z } from '../zod';
import { num } from '../../ir/format';
import type { InventoryView, LocalNote, LocalTrack } from '../../ir/types';
import type { EffectModule } from '../schema';

const percent = z.number().min(0).max(100);

export const DrawParams = z.object({
  from: percent.default(0),
  to: percent.default(100),
});

/** The target if it is a shape, or every shape drawn inside a group. */
export function shapesOf(key: string, inventory: InventoryView): string[] {
  const node = inventory.nodes.get(key)!;
  if (node.type !== 'g') return [key];
  return node.children.flatMap((child) => (inventory.nodes.get(child)!.referenced ? [] : shapesOf(child, inventory)));
}

export const draw: EffectModule<'draw'> = {
  type: 'draw',
  label: 'Draw',
  params: DrawParams,
  ui: [
    { kind: 'range', key: 'from', label: 'From', min: 0, max: 100, step: 1, unit: '%' },
    { kind: 'range', key: 'to', label: 'To', min: 0, max: 100, step: 1, unit: '%' },
  ],
  pivot: false,
  compile({ targets, params }, inventory) {
    const tracks: LocalTrack[] = [];
    const notes: LocalNote[] = [];
    for (const target of targets) {
      const shapes = shapesOf(target, inventory).filter((key) => inventory.measure(key)?.length !== undefined);
      if (!shapes.length) notes.push({ code: 'no-length', target });
      for (const shape of shapes) {
        const { length, stroke, dashed } = inventory.measure(shape)!;
        if (stroke === 'none') {
          notes.push({ code: 'no-stroke', target: shape });
          continue;
        }
        if (dashed) notes.push({ code: 'dashed', target: shape });
        const total = length!;
        // A gap twice the length, so at 0 % no round cap peeks out where the next dash would start.
        const dashes = `${num(total)} ${num(total * 2)}`;
        const offset = (percent: number) => num(total * (1 - percent / 100));
        tracks.push(
          { target: shape, property: 'stroke-dasharray', keyframes: [{ offset: 0, value: dashes }, { offset: 1, value: dashes }] },
          {
            target: shape,
            property: 'stroke-dashoffset',
            keyframes: [
              { offset: 0, value: offset(params.from) },
              { offset: 1, value: offset(params.to) },
            ],
          },
        );
      }
    }
    return { tracks, notes };
  },
};

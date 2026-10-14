// The spec is the only state (invariant 5). See docs/ARCHITECTURE.md section 3.
import { z } from 'zod';
import type { InventoryView, LocalNote, LocalTrack } from '../ir/types';
import { draw, DrawParams } from './effects/draw';
import { spin, SpinParams } from './effects/spin';

const unit = z.number().min(0).max(1);
const key = z.string().min(1).max(64);

export const EasingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cubic'), p: z.tuple([unit, z.number().min(-5).max(5), unit, z.number().min(-5).max(5)]) }),
  z.object({ kind: z.literal('steps'), n: z.int().min(1).max(100), pos: z.enum(['start', 'end']) }),
]);

export const TimingSchema = z.object({
  /** Seconds from the start of the timeline. */
  start: z.number().min(0).max(60),
  /** Seconds per run. */
  duration: z.number().min(0.05).max(60),
  easing: EasingSchema,
  /** Whole runs. 'infinite' repeats until the timeline ends. */
  iterations: z.union([z.int().min(1).max(100), z.literal('infinite')]),
  direction: z.enum(['normal', 'reverse', 'alternate']),
});

const base = {
  id: key,
  targets: z.array(key).min(1).max(20_000),
  timing: TimingSchema,
  /** Fraction of each target's box. Transform effects only. Default centre. */
  pivot: z.object({ fx: unit, fy: unit }).optional(),
};

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('spin'), params: SpinParams }),
  z.object({ ...base, type: z.literal('draw'), params: DrawParams }),
]);

export const SpecSchema = z.object({
  version: z.literal(1),
  /** Seconds. */
  duration: z.number().min(0.1).max(60),
  loop: z.boolean(),
  effects: z.array(EffectSchema).max(200),
});

export type Easing = z.infer<typeof EasingSchema>;
export type Timing = z.infer<typeof TimingSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect['type'];
export type Spec = z.infer<typeof SpecSchema>;

/** A slider in the generated control panel. */
export type Control = { key: string; label: string; min: number; max: number; step: number; unit: string };

export type EffectModule<T extends EffectType> = {
  type: T;
  label: string;
  params: z.ZodType<Extract<Effect, { type: T }>['params']>;
  ui: Control[];
  /** Moves the wrapper, so it has a pivot. */
  transform: boolean;
  /** One run per target. Targets are known to exist in the inventory. */
  compile(effect: Extract<Effect, { type: T }>, inventory: InventoryView): { tracks: LocalTrack[]; notes: LocalNote[] };
};

export const EFFECTS: { [T in EffectType]: EffectModule<T> } = { spin, draw };

export function newSpec(): Spec {
  return { version: 1, duration: 2, loop: true, effects: [] };
}

export function newEffect(type: EffectType, targets: string[], id: string): Effect {
  return {
    id,
    type,
    targets,
    params: EFFECTS[type].params.parse({}),
    timing: { start: 0, duration: 1, easing: { kind: 'cubic', p: [0.42, 0, 0.58, 1] }, iterations: 1, direction: 'normal' },
  } as Effect;
}

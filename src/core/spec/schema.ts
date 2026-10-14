// The spec is the only state (invariant 5). See docs/ARCHITECTURE.md section 3.
import { z } from 'zod';
import type { InventoryView, LocalNote, LocalTrack } from '../ir/types';
import { colour, ColourParams } from './effects/colour';
import { draw, DrawParams } from './effects/draw';
import { fade, FadeParams } from './effects/fade';
import { slide, SlideParams } from './effects/slide';
import { pop, PopParams } from './effects/pop';
import { pulse, PulseParams } from './effects/pulse';
import { spin, SpinParams } from './effects/spin';
import { wiggle, WiggleParams } from './effects/wiggle';

// No eval. Zod otherwise probes `new Function` on first parse, and Firefox reports the CSP block as an error.
z.config({ jitless: true });

const unit = z.number().min(0).max(1);
const key = z.string().min(1).max(64);

export const EasingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cubic'), p: z.tuple([unit, z.number().min(-5).max(5), unit, z.number().min(-5).max(5)]) }),
  z.object({ kind: z.literal('steps'), n: z.int().min(1).max(100), pos: z.enum(['start', 'end']) }),
  /** Settles within the run. 0 is no overshoot; higher bounces more. Compiles to linear() stops. */
  z.object({ kind: z.literal('spring'), bounce: z.number().min(0).max(0.9) }),
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
  /** Starts each target `gap` seconds after the one before, in this order. */
  stagger: z
    .object({
      gap: z.number().min(0).max(10),
      /** start and end are document order; centre, x and y go by position; random uses the seed. */
      order: z.enum(['start', 'end', 'centre', 'random', 'x', 'y']),
      seed: z.int().min(0).max(2 ** 32 - 1),
    })
    .optional(),
};

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('spin'), params: SpinParams }),
  z.object({ ...base, type: z.literal('fade'), params: FadeParams }),
  z.object({ ...base, type: z.literal('draw'), params: DrawParams }),
  z.object({ ...base, type: z.literal('colour'), params: ColourParams }),
  z.object({ ...base, type: z.literal('slide'), params: SlideParams }),
  z.object({ ...base, type: z.literal('pop'), params: PopParams }),
  z.object({ ...base, type: z.literal('pulse'), params: PulseParams }),
  z.object({ ...base, type: z.literal('wiggle'), params: WiggleParams }),
]);

export const SpecSchema = z.object({
  version: z.literal(1),
  /** Seconds. */
  duration: z.number().min(0.1).max(60),
  loop: z.boolean(),
  effects: z
    .array(EffectSchema)
    .max(200)
    // Here, not on EffectSchema: EFFECTS' type is built from Effect, so checking it there is circular.
    .superRefine((effects, context) =>
      effects.forEach((effect, i) => {
        if (effect.timing.duration < (EFFECTS[effect.type].minDuration ?? 0))
          context.addIssue({ code: 'custom', message: 'Runs too fast for this effect.', path: [i, 'timing', 'duration'] });
      }),
    ),
});

export type Easing = z.infer<typeof EasingSchema>;
export type Timing = z.infer<typeof TimingSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect['type'];
export type Spec = z.infer<typeof SpecSchema>;

/** A control in the generated panel, for one key of an effect's params. */
export type Control = { key: string; label: string } & (
  | { kind: 'range'; min: number; max: number; step: number; unit: string }
  | { kind: 'select'; options: { value: string; label: string }[] }
  | { kind: 'colour' }
);

export type EffectModule<T extends EffectType> = {
  type: T;
  label: string;
  params: z.ZodType<Extract<Effect, { type: T }>['params']>;
  ui: Control[];
  /** Rotates or scales about a point in each target, so it shows a pivot handle. */
  pivot: boolean;
  /** Timing a new effect starts with, over the shared defaults. */
  timing?: Partial<Timing>;
  /** Seconds. The shortest run allowed, for effects that would flash (WCAG 2.3.1). */
  minDuration?: number;
  /** One run per target. Targets are known to exist in the inventory. */
  compile(effect: Extract<Effect, { type: T }>, inventory: InventoryView): { tracks: LocalTrack[]; notes: LocalNote[] };
};

export const EFFECTS: { [T in EffectType]: EffectModule<T> } = { spin, fade, draw, colour, slide, pop, pulse, wiggle };

export function newSpec(): Spec {
  return { version: 1, duration: 2, loop: true, effects: [] };
}

export function newEffect(type: EffectType, targets: string[], id: string): Effect {
  return {
    id,
    type,
    targets,
    params: EFFECTS[type].params.parse({}),
    timing: {
      start: 0,
      duration: 1,
      easing: { kind: 'cubic', p: [0.42, 0, 0.58, 1] },
      iterations: 1,
      direction: 'normal',
      ...structuredClone(EFFECTS[type].timing),
    },
  } as Effect;
}

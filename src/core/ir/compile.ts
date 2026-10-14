// compile(spec, inventory) -> IR. Pure. See docs/ARCHITECTURE.md section 3.
//
// Every track spans the whole timeline, so the timeline can loop as one and every backend
// shares one clock. Each effect describes one run; this file places the runs, mirrors
// reversed ones, merges effects on the same target and property, and holds values between them.
// Transforms are the exception: they stack, one track per effect, in list order.
import { EFFECTS, type Easing, type Effect, type EffectModule, type EffectType, type Spec, type Timing } from '../spec/schema';
import { num, random } from './format';
import { ADDITIVE_PROPERTIES, WRAPPER_PROPERTIES, type InventoryView, type IR, type Keyframe, type LocalTrack, type Note, type NoteCode, type Track } from './types';

// Floating point slack when fitting runs into the timeline, in seconds.
const EPSILON = 1e-9;

// Roughly the bytes of keyframes one IR may hold. Specs come from storage, so a hostile one could
// otherwise ask for hundreds of megabytes (tiny runs, springs, thousands of targets). Effects past it
// are skipped with a note. A 200-shape spin with a spring over a 2 s loop uses 0.6% of it.
// ponytail: one global figure; per-file caps arrive with the M7 performance work.
export const BUDGET = 16_000_000;

type Run = { start: number; end: number; reversed: boolean };

/** A keyframe at an absolute time. */
type Timed = { time: number; value: string; easing: string };

/** One effect's runs on one target and property. */
type Window = { effect: string; order: number; start: number; end: number; keyframes: Timed[] };

/**
 * A damped spring from 0 to 1 as [time, value] points across one run, ending exactly at [1, 1].
 * Damping ratio is 1 - bounce. Stiffness is set so the wobble has decayed to 0.01% by the end of the run,
 * so a run is the whole spring and nothing is cut off.
 */
export function springPoints(bounce: number): [number, number][] {
  const zeta = 1 - bounce;
  const omega = Math.log(1e4) / zeta;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const at = (t: number) =>
    damped === 0
      ? 1 - Math.exp(-omega * t) * (1 + omega * t)
      : 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
  // At least 12 stops per wobble and 30 per run, until the wobble is under 0.1% of the travel.
  const step = Math.min(1 / 30, damped ? (2 * Math.PI) / damped / 12 : 1);
  const points: [number, number][] = [];
  for (let t = 0; t < 1 && (t === 0 || Math.exp(-zeta * omega * t) >= 1e-3); t += step) points.push([t, at(t)]);
  points.push([1, 1]);
  return points;
}

/** CSS for an easing, mirrored for a reversed run as CSS reverse and alternate do. */
export function easingCss(easing: Easing, reversed = false): string {
  if (easing.kind === 'spring') {
    // Mirrored, a stop at (x, y) moves to (1 - x, 1 - y), and the order reverses.
    const points = springPoints(easing.bounce).map(([x, y]) => (reversed ? [1 - x, 1 - y] : [x, y]));
    if (reversed) points.reverse();
    return `linear(${points.map(([x, y]) => `${num(y)} ${num(x * 100)}%`).join(', ')})`;
  }
  if (easing.kind === 'steps') {
    const pos = reversed ? (easing.pos === 'start' ? 'end' : 'start') : easing.pos;
    return `steps(${easing.n}, ${pos})`;
  }
  const [x1, y1, x2, y2] = easing.p;
  const p = reversed ? [1 - x2, 1 - y2, 1 - x1, 1 - y1] : [x1, y1, x2, y2];
  return `cubic-bezier(${p.map(num).join(', ')})`;
}

/** Whole runs that fit before the end. One run that does not fit is shortened instead. */
export function planRuns({ start, duration, iterations, direction }: Timing, total: number): { runs: Run[]; code?: NoteCode } {
  const room = total - start;
  if (room <= EPSILON) return { runs: [], code: 'outside' };
  const fit = Math.floor(room / duration + EPSILON);
  let count = iterations === 'infinite' ? fit : Math.min(iterations, fit);
  let length = duration;
  let code: NoteCode | undefined = iterations !== 'infinite' && count < iterations ? 'squeezed' : undefined;
  if (count < 1) [count, length, code] = [1, room, 'squeezed'];

  const runs: Run[] = [];
  for (let i = 0; i < count; i++) {
    const reversed = direction === 'reverse' || (direction === 'alternate' && i % 2 === 1);
    runs.push({ start: start + i * length, end: start + (i + 1) * length, reversed });
  }
  return { runs, code };
}

/** Easing CSS forwards and mirrored, made once per effect: a spring's stops are costly. */
type Easings = { forward: string; reversed: string };

function place(track: LocalTrack, runs: Run[], easings: Easings): Timed[] {
  return runs.flatMap(({ start, end, reversed }) => {
    const frames = reversed ? track.keyframes.map(({ offset, value }) => ({ offset: 1 - offset, value })).reverse() : track.keyframes;
    const css = reversed ? easings.reversed : easings.forward;
    return frames.map(({ offset, value }, i) => ({
      // Exact at the ends, so a run's end and the next run's start share an offset.
      time: offset === 1 ? end : start + offset * (end - start),
      value,
      easing: i === frames.length - 1 ? 'linear' : css,
    }));
  });
}

/** Adds a keyframe, folding it into the last one when it repeats it exactly. */
function push(out: Timed[], frame: Timed): void {
  const last = out.at(-1);
  if (last && last.time === frame.time && last.value === frame.value) out[out.length - 1] = frame;
  else out.push(frame);
}

/** Lays non-overlapping windows end to end on the timeline, holding values in between. */
function join(windows: Window[], total: number): Timed[] {
  const out: Timed[] = [];
  for (const window of windows) {
    const last = out.at(-1);
    if (!last) {
      if (window.start > 0) out.push({ time: 0, value: window.keyframes[0].value, easing: 'linear' });
    } else {
      last.easing = 'linear';
      // Hold, then jump at the start of the next window if the values differ.
      push(out, { time: window.start, value: last.value, easing: 'linear' });
    }
    for (const frame of window.keyframes) push(out, { ...frame });
  }
  const last = out.at(-1)!;
  last.easing = 'linear';
  if (last.time < total) out.push({ time: total, value: last.value, easing: 'linear' });
  return out;
}

/** Targets in the order a stagger starts them. Ties keep document order. */
export function staggerOrder(targets: string[], { order, seed }: NonNullable<Effect['stagger']>, inventory: InventoryView): string[] {
  const position = new Map([...inventory.nodes.keys()].map((key, i) => [key, i]));
  const keys = [...targets].sort((a, b) => position.get(a)! - position.get(b)!);
  if (order === 'start') return keys;
  if (order === 'end') return keys.reverse();
  if (order === 'random') {
    const next = random(seed);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
  }
  // ponytail: boxes are in each target's parent space, so position orders are exact for siblings
  // and approximate across groups with their own transforms. Use screen boxes if that shows.
  const centres = new Map(
    keys.map((key) => {
      const box = inventory.measure(key)?.bbox ?? { x: 0, y: 0, width: 0, height: 0 };
      return [key, { x: box.x + box.width / 2, y: box.y + box.height / 2 }];
    }),
  );
  const all = [...centres.values()];
  const middle = { x: all.reduce((sum, c) => sum + c.x, 0) / all.length, y: all.reduce((sum, c) => sum + c.y, 0) / all.length };
  const rank = (key: string) => {
    const c = centres.get(key)!;
    return order === 'x' ? c.x : order === 'y' ? c.y : Math.hypot(c.x - middle.x, c.y - middle.y);
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}

export function compile(spec: Spec, inventory: InventoryView): IR {
  const total = spec.duration;
  const found = new Map<string, Note>();
  const note = (effect: string, code: NoteCode, target: string) => {
    const id = `${effect}|${code}`;
    const entry = found.get(id) ?? found.set(id, { effect, code, targets: [] }).get(id)!;
    if (!entry.targets.includes(target)) entry.targets.push(target);
  };

  const groups = new Map<string, { target: string; property: Track['property']; windows: Window[] }>();
  let spent = 0;

  spec.effects.forEach((effect, order) => {
    const targets = [...new Set(effect.targets)].filter((key) => inventory.nodes.has(key));
    for (const key of effect.targets) if (!inventory.nodes.has(key)) note(effect.id, 'missing', key);
    if (!targets.length) return;

    const module = EFFECTS[effect.type] as EffectModule<EffectType>;
    const easings = { forward: easingCss(effect.timing.easing), reversed: easingCss(effect.timing.easing, true) };
    const longest = Math.max(easings.forward.length, easings.reversed.length);
    // A stagger gives each target its own start, so each is planned and compiled on its own.
    const { stagger } = effect;
    const batches = stagger
      ? staggerOrder(targets, stagger, inventory).map((key, i) => ({ targets: [key], start: effect.timing.start + i * stagger.gap }))
      : [{ targets, start: effect.timing.start }];

    for (const batch of batches) {
      const { runs, code } = planRuns({ ...effect.timing, start: batch.start }, total);
      if (code) for (const key of batch.targets) note(effect.id, code, key);
      if (!runs.length) continue;

      const local = module.compile({ ...effect, targets: batch.targets }, inventory);
      for (const { code, target } of local.notes) note(effect.id, code, target);

      // Counted before placing, so an effect over budget costs nothing more.
      const cost = local.tracks.reduce((sum, track) => sum + track.keyframes.reduce((n, k) => n + k.value.length + longest, 0), 0) * runs.length;
      if (spent + cost > BUDGET) {
        for (const key of batch.targets) note(effect.id, 'too-big', key);
        continue;
      }
      spent += cost;

      for (const track of local.tracks) {
        if (WRAPPER_PROPERTIES.has(track.property) && !inventory.nodes.get(track.target)?.wrapped) {
          note(effect.id, 'unwrapped', track.target);
          continue;
        }
        // Transforms stack, so each effect keeps its own track. Everything else merges into one.
        const id = `${track.target}|${track.property}${ADDITIVE_PROPERTIES.has(track.property) ? `|${effect.id}` : ''}`;
        const group = groups.get(id) ?? groups.set(id, { target: track.target, property: track.property, windows: [] }).get(id)!;
        group.windows.push({
          effect: effect.id,
          order,
          start: runs[0].start,
          end: runs.at(-1)!.end,
          keyframes: place(track, runs, easings),
        });
      }
    }
  });

  const tracks: Track[] = [];
  for (const { target, property, windows } of groups.values()) {
    // Earliest first. Where two overlap, the one later in the effect list wins.
    windows.sort((a, b) => a.start - b.start || a.order - b.order);
    const kept: Window[] = [];
    for (const window of windows) {
      const last = kept.at(-1);
      if (last && window.start < last.end - EPSILON) {
        const loser = window.order > last.order ? kept.pop()! : window;
        note(loser.effect, 'overlap', target);
        if (loser === window) continue;
      }
      kept.push(window);
    }
    const keyframes: Keyframe[] = join(kept, total).map(({ time, value, easing }) => ({ offset: time / total, value, easing }));
    tracks.push({ target, property, keyframes });
  }

  return { duration: total, iterations: spec.loop ? 'infinite' : 1, tracks, notes: [...found.values()] };
}

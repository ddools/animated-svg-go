// compile(spec, inventory) -> IR. Pure. See docs/ARCHITECTURE.md section 3.
//
// Every track spans the whole timeline, so the timeline can loop as one and every backend
// shares one clock. Each effect describes one run; this file places the runs, mirrors
// reversed ones, merges effects on the same target and property, and holds values between them.
// Transforms are the exception: they stack, one track per effect, in list order.
import { EFFECTS, type Easing, type EffectModule, type EffectType, type Spec, type Timing } from '../spec/schema';
import { num } from './format';
import { ADDITIVE_PROPERTIES, WRAPPER_PROPERTIES, type InventoryView, type IR, type Keyframe, type LocalTrack, type Note, type NoteCode, type Track } from './types';

// Floating point slack when fitting runs into the timeline, in seconds.
const EPSILON = 1e-9;

type Run = { start: number; end: number; reversed: boolean };

/** A keyframe at an absolute time. */
type Timed = { time: number; value: string; easing: string };

/** One effect's runs on one target and property. */
type Window = { effect: string; order: number; start: number; end: number; keyframes: Timed[] };

/** CSS for an easing, mirrored for a reversed run as CSS reverse and alternate do. */
export function easingCss(easing: Easing, reversed = false): string {
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

function place(track: LocalTrack, runs: Run[], easing: Easing): Timed[] {
  return runs.flatMap(({ start, end, reversed }) => {
    const frames = reversed ? track.keyframes.map(({ offset, value }) => ({ offset: 1 - offset, value })).reverse() : track.keyframes;
    const css = easingCss(easing, reversed);
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

export function compile(spec: Spec, inventory: InventoryView): IR {
  const total = spec.duration;
  const found = new Map<string, Note>();
  const note = (effect: string, code: NoteCode, target: string) => {
    const id = `${effect}|${code}`;
    const entry = found.get(id) ?? found.set(id, { effect, code, targets: [] }).get(id)!;
    if (!entry.targets.includes(target)) entry.targets.push(target);
  };

  const groups = new Map<string, { target: string; property: Track['property']; windows: Window[] }>();

  spec.effects.forEach((effect, order) => {
    const targets = effect.targets.filter((key) => inventory.nodes.has(key));
    for (const key of effect.targets) if (!inventory.nodes.has(key)) note(effect.id, 'missing', key);
    if (!targets.length) return;

    const { runs, code } = planRuns(effect.timing, total);
    if (code) for (const key of targets) note(effect.id, code, key);
    if (!runs.length) return;

    const module = EFFECTS[effect.type] as EffectModule<EffectType>;
    const local = module.compile({ ...effect, targets }, inventory);
    for (const { code, target } of local.notes) note(effect.id, code, target);

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
        keyframes: place(track, runs, effect.timing.easing),
      });
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

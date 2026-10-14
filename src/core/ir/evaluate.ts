// The IR's values at one moment, computed the way browsers do. Pure. See docs/ARCHITECTURE.md section 3.
//
// Raster export draws frames from this, so it has to agree with WAAPI and CSS to the pixel.
// Parity tests compare it with both.
import { num } from './format';
import type { IR, Keyframe, Property } from './types';

export type Sampled = { target: string; property: Property; value: string };

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;

/** x or y of a cubic Bézier from (0,0) to (1,1) with control points a and b, at parameter s. */
const bezier = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * (1 - s) * s + 3 * (1 - b) * s ** 2;

/** Solves x(s) = x by Newton's method, then bisection if that stalls, as browsers' UnitBezier does. */
function cubic(x1: number, y1: number, x2: number, y2: number, x: number): number {
  let s = x;
  for (let i = 0; i < 8; i++) {
    const error = bezier(x1, x2, s) - x;
    if (Math.abs(error) < 1e-7) return bezier(y1, y2, s);
    const d = slope(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    s -= error / d;
  }
  let [low, high] = [0, 1];
  s = x;
  while (high - low > 1e-7) {
    if (bezier(x1, x2, s) < x) low = s;
    else high = s;
    s = (low + high) / 2;
  }
  return bezier(y1, y2, s);
}

/** Output progress for input progress p, for the easings the IR uses. Throws on any other. */
export function ease(css: string, p: number): number {
  if (css === 'linear') return p;
  const bez = /^cubic-bezier\(([^)]*)\)$/.exec(css);
  if (bez) {
    const [x1, y1, x2, y2] = bez[1].split(',').map(Number);
    if (p <= 0 || p >= 1) return p;
    return cubic(x1, y1, x2, y2, p);
  }
  const steps = /^steps\((\d+),\s*(start|end)\)$/.exec(css);
  if (steps) {
    // CSS Easing 1, step easing, for forward progress (fill both never needs the before flag).
    const n = Number(steps[1]);
    const step = Math.floor(p * n) + (steps[2] === 'start' ? 1 : 0);
    return Math.min(Math.max(step, 0), n) / n;
  }
  throw new Error(`Unsupported easing: ${css}`);
}

/** Interpolates two CSS values number by number. Their text between numbers must match, else it flips at half way, as CSS does. */
export function mix(from: string, to: string, p: number): string {
  const skeleton = (value: string) => value.replace(NUMBER, '#');
  if (skeleton(from) !== skeleton(to)) return p < 0.5 ? from : to;
  const ends = to.match(NUMBER) ?? [];
  let i = 0;
  return from.replace(NUMBER, (start) => {
    const a = Number(start);
    return num(a + (Number(ends[i++]) - a) * p);
  });
}

/** One track's value at iteration progress p, with keyframe intervals chosen as Web Animations chooses them. */
function valueAt(keyframes: Keyframe[], p: number): string {
  const last = keyframes.at(-1)!;
  if (p >= last.offset) return last.value;
  // The last keyframe at or before p. Two at one offset are a jump, and the later one wins.
  let i = 0;
  while (i + 1 < keyframes.length && keyframes[i + 1].offset <= p) i++;
  const [start, end] = [keyframes[i], keyframes[i + 1]];
  const local = (p - start.offset) / (end.offset - start.offset);
  return mix(start.value, end.value, ease(start.easing, local));
}

/** Every track's value t seconds into the timeline. */
export function evaluate(ir: IR, t: number): Sampled[] {
  const elapsed = Math.max(t, 0) / ir.duration;
  // At an exact multiple of the duration, a looping timeline is at the start of its next run.
  const p = ir.iterations === 'infinite' ? elapsed % 1 : Math.min(elapsed, 1);
  return ir.tracks.map(({ target, property, keyframes }) => ({ target, property, value: valueAt(keyframes, p) }));
}

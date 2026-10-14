/** A number for a CSS value: three decimal places, no trailing zeros, never "-0". */
export function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

/** Numbers from 0 to 1 that are the same for the same seed every time (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

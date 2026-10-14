/** A number for a CSS value: three decimal places, no trailing zeros, never "-0". */
export function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

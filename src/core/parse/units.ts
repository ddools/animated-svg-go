// CSS reference pixels per unit, at 96 dpi.
const PX_PER_UNIT: Record<string, number> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
  pc: 16,
};

/** Absolute SVG length to user units. Null for relative units (%, em, ex) and junk. */
export function toUserUnits(length: string | null): number | null {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(length ?? '');
  if (!match) return null;
  const factor = PX_PER_UNIT[match[2].toLowerCase()];
  if (factor === undefined) return null;
  const value = Number(match[1]) * factor;
  return Number.isFinite(value) && value > 0 ? value : null;
}

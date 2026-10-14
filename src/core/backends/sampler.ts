// Static frames for raster export and the parity test. See docs/ARCHITECTURE.md section 5.
import { evaluate } from '../ir/evaluate';
import type { IR } from '../ir/types';
import { checkValue, selector } from './css';

/**
 * The IR's values at t seconds as plain CSS rules on the export's selectors.
 * Important, so an authored inline style cannot beat them, as an animation would not let it.
 */
export function frameCss(ir: IR, t: number, scope: string): string {
  // Static rules can't compose, so stacked transforms are written as one list, in track order.
  // compile gives every other property one track per target, so nothing else is joined.
  const rules = new Map<string, string>();
  for (const sample of evaluate(ir, t)) {
    const rule = `${selector(scope, sample)}{${sample.property}:`;
    const value = checkValue(sample.value);
    const before = rules.get(rule);
    rules.set(rule, before === undefined ? value : `${before} ${value}`);
  }
  return [...rules].map(([rule, value]) => `${rule}${value} !important}`).join('\n');
}

// Static frames for raster export and the parity test. See docs/ARCHITECTURE.md section 5.
import { evaluate } from '../ir/evaluate';
import type { IR } from '../ir/types';
import { checkValue, selector } from './css';

/**
 * The IR's values at t seconds as plain CSS rules on the export's selectors.
 * Important, so an authored inline style cannot beat them, as an animation would not let it.
 */
export function frameCss(ir: IR, t: number, scope: string): string {
  return evaluate(ir, t)
    .map((sample) => `${selector(scope, sample)}{${sample.property}:${checkValue(sample.value)} !important}`)
    .join('\n');
}

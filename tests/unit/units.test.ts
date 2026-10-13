import { expect, test } from 'vitest';
import { toUserUnits } from '../../src/core/parse/units';

test('absolute units convert at 96 dpi', () => {
  expect(toUserUnits('100')).toBe(100);
  expect(toUserUnits('100px')).toBe(100);
  expect(toUserUnits('1in')).toBe(96);
  expect(toUserUnits('25.4mm')).toBeCloseTo(96);
  expect(toUserUnits('2.54cm')).toBeCloseTo(96);
  expect(toUserUnits('72pt')).toBeCloseTo(96);
  expect(toUserUnits('6pc')).toBe(96);
  expect(toUserUnits(' 1e2 PX ')).toBe(100);
});

test('relative, missing and nonsense lengths are null', () => {
  for (const bad of [null, '', '100%', '2em', '3ex', 'auto', '0', '-5px', '1 2', 'NaNpx']) {
    expect(toUserUnits(bad)).toBeNull();
  }
});

import { expect, test } from 'vitest';
import { fnv1a } from '../../src/core/parse/hash';

test('fnv1a matches published test vectors', () => {
  expect(fnv1a('')).toBe('811c9dc5');
  expect(fnv1a('a')).toBe('e40c292c');
  expect(fnv1a('foobar')).toBe('bf9cf968');
});

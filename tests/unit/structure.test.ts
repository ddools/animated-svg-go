import { describe, expect, it } from 'vitest';
import { newKey } from '../../src/core/parse/edit';
import { newSpec, SpecSchema } from '../../src/core/spec/schema';

// The edit pass itself needs a DOM, so it is tested in the browser (tests/e2e/structure.spec.ts, tests/security).
describe('structure ops', () => {
  const valid = (structure: unknown) => SpecSchema.safeParse({ ...newSpec(), structure }).success;

  it('are optional, so older saves still load', () => {
    expect(valid(undefined)).toBe(true);
  });

  it('accept delete, duplicate and group', () => {
    expect(valid([{ op: 'delete', keys: ['k1'], seed: 0 }, { op: 'duplicate', keys: ['k1'], seed: 2 ** 32 - 1 }, { op: 'group', keys: ['k1', 'k2'], seed: 7 }])).toBe(true);
  });

  it('refuse anything else', () => {
    expect(valid([{ op: 'ungroup', keys: ['k1'], seed: 0 }])).toBe(false);
    expect(valid([{ op: 'delete', keys: [], seed: 0 }])).toBe(false);
    expect(valid([{ op: 'delete', keys: ['k1'], seed: -1 }])).toBe(false);
    expect(valid([{ op: 'delete', keys: ['k1'], seed: 1.5 }])).toBe(false);
    expect(valid(Array.from({ length: 501 }, () => ({ op: 'delete', keys: ['k1'], seed: 0 })))).toBe(false);
  });

  it('derive keys the CSS backend accepts, the same every time', () => {
    expect(newKey(42, 'k1a2b3c4d')).toMatch(/^k[0-9a-f]{8}$/);
    expect(newKey(42, 'k1a2b3c4d')).toBe(newKey(42, 'k1a2b3c4d'));
    expect(newKey(42, 'group')).not.toBe(newKey(43, 'group'));
  });
});

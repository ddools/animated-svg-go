import { describe, expect, it } from 'vitest';
import { frameTimes, rasterSize } from '../../src/core/export/frames';

describe('frameTimes', () => {
  it('leaves out the end of a loop, which is its start again', () => {
    expect(frameTimes(1, 4, true)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('keeps the end of a timeline that plays once', () => {
    expect(frameTimes(1, 4, false)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('spaces frames evenly over the whole timeline when fps does not divide it', () => {
    const times = frameTimes(1.01, 30, true);
    expect(times).toHaveLength(30);
    expect(times[29] + 1.01 / 30).toBeCloseTo(1.01, 10);
  });

  it('draws at least one frame', () => {
    expect(frameTimes(0.01, 15, true)).toEqual([0]);
  });

  it('refuses a duration or fps that would loop forever', () => {
    for (const [d, f] of [[0, 30], [1, 0], [Number.NaN, 30], [1, Number.POSITIVE_INFINITY]]) {
      expect(() => frameTimes(d, f, true)).toThrow();
    }
  });
});

describe('rasterSize', () => {
  it('keeps the shape and makes both sides even', () => {
    expect(rasterSize({ width: 400, height: 225 }, 720)).toEqual({ width: 720, height: 406 });
    expect(rasterSize({ width: 200, height: 100 }, 1080)).toEqual({ width: 1080, height: 540 });
  });

  it('never goes below two pixels', () => {
    expect(rasterSize({ width: 1000, height: 1 }, 480)).toEqual({ width: 480, height: 2 });
  });
});

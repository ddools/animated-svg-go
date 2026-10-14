import { describe, expect, it } from 'vitest';
import { gifDelay, sampleTimes } from '../../src/core/export/gif';
import { frameStep } from '../../src/core/export/frames';

describe('gifDelay', () => {
  it('keeps time at 30 fps, though GIF counts in hundredths', () => {
    const step = frameStep(2, 30);
    const delays = Array.from({ length: 60 }, (_, i) => gifDelay(i, step));
    expect(new Set(delays)).toEqual(new Set([30, 40]));
    expect(delays.reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it('is exact where the step is whole hundredths', () => {
    expect(Array.from({ length: 4 }, (_, i) => gifDelay(i, frameStep(1, 4)))).toEqual([250, 250, 250, 250]);
  });
});

describe('sampleTimes', () => {
  it('spreads samples over the pass', () => {
    expect(sampleTimes([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 3, 6]);
  });

  it('takes every frame when there are few', () => {
    expect(sampleTimes([0, 0.5], 3)).toEqual([0, 0.5]);
  });
});

import { describe, expect, it } from 'vitest';
import { ease, evaluate, mix } from '../../src/core/ir/evaluate';
import type { IR, Keyframe } from '../../src/core/ir/types';

describe('ease', () => {
  it('matches known cubic-bezier values', () => {
    // CSS "ease" at half way, as browsers compute it.
    expect(ease('cubic-bezier(0.25, 0.1, 0.25, 1)', 0.5)).toBeCloseTo(0.8024, 4);
    // Symmetric curves cross the middle at the middle.
    expect(ease('cubic-bezier(0.42, 0, 0.58, 1)', 0.5)).toBeCloseTo(0.5, 6);
    expect(ease('cubic-bezier(0, 0, 1, 1)', 0.3)).toBeCloseTo(0.3, 6);
  });

  it('solves where the slope is flat and Newton stalls', () => {
    // x = s³ here, so x = 0.001 at s = 0.1, where y = 0.243 + 0.027 + 0.001.
    expect(ease('cubic-bezier(0, 1, 0, 1)', 0.001)).toBeCloseTo(0.271, 5);
  });

  it('keeps overshoot beyond 0 and 1', () => {
    expect(ease('cubic-bezier(0.3, 1.6, 0.7, 1.6)', 0.5)).toBeGreaterThan(1);
  });

  it('steps at the start or the end of each step', () => {
    expect([0, 0.24, 0.25, 0.99, 1].map((p) => ease('steps(4, end)', p))).toEqual([0, 0, 0.25, 0.75, 1]);
    expect([0, 0.24, 0.25, 0.99, 1].map((p) => ease('steps(4, start)', p))).toEqual([0.25, 0.25, 0.5, 1, 1]);
  });

  it('refuses easings the IR does not produce', () => {
    expect(() => ease('ease-in', 0.5)).toThrow();
  });
});

describe('mix', () => {
  it('interpolates every number in matching function lists', () => {
    expect(mix('translate(5px, 5px) rotate(0deg) translate(-5px, -5px)', 'translate(5px, 5px) rotate(90deg) translate(-5px, -5px)', 0.5)).toBe(
      'translate(5px, 5px) rotate(45deg) translate(-5px, -5px)',
    );
    expect(mix('40 80', '40 80', 0.3)).toBe('40 80');
    expect(mix('0', '1', 0.25)).toBe('0.25');
  });

  it('flips at half way when the lists differ', () => {
    expect(mix('rotate(0deg)', 'scale(2)', 0.49)).toBe('rotate(0deg)');
    expect(mix('rotate(0deg)', 'scale(2)', 0.5)).toBe('scale(2)');
  });
});

const k = (offset: number, value: string, easing = 'linear'): Keyframe => ({ offset, value, easing });
const ir = (keyframes: Keyframe[], iterations: IR['iterations'] = 1): IR => ({
  duration: 4,
  iterations,
  tracks: [{ target: 'k1', property: 'opacity', keyframes }],
  notes: [],
});
const at = (value: IR, t: number) => evaluate(value, t)[0].value;

describe('evaluate', () => {
  it('holds, eases and holds again across the timeline', () => {
    const track = ir([k(0, '0'), k(0.25, '0', 'cubic-bezier(0.42, 0, 0.58, 1)'), k(0.75, '1'), k(1, '1')]);
    expect(at(track, 0.5)).toBe('0');
    expect(at(track, 2)).toBe('0.5');
    expect(Number(at(track, 1.5))).toBeLessThan(0.25);
    expect(at(track, 3.5)).toBe('1');
  });

  it('takes the later value at a jump', () => {
    const track = ir([k(0, '0'), k(0.5, '0'), k(0.5, '1'), k(1, '1')]);
    expect(at(track, 1.999)).toBe('0');
    expect(at(track, 2)).toBe('1');
  });

  it('wraps a looping timeline and holds the end of one that does not loop', () => {
    const frames = [k(0, '0'), k(1, '1')];
    expect(at(ir(frames, 'infinite'), 5)).toBe('0.25');
    expect(at(ir(frames, 'infinite'), 4)).toBe('0');
    expect(at(ir(frames, 1), 5)).toBe('1');
    expect(at(ir(frames, 1), -1)).toBe('0');
  });

  it('applies each interval its own easing, as compile writes reversed runs', () => {
    const track = ir([k(0, '0', 'steps(2, end)'), k(0.5, '1', 'steps(2, start)'), k(1, '0')]);
    expect(at(track, 0.9)).toBe('0');
    expect(at(track, 1.1)).toBe('0.5');
    expect(at(track, 2.1)).toBe('0.5');
    expect(at(track, 3.1)).toBe('0');
  });
});

import { describe, expect, it } from 'vitest';
import { css, scopeOf, selector } from '../../src/core/backends/css';
import { frameCss } from '../../src/core/backends/sampler';
import type { IR, Track } from '../../src/core/ir/types';

const spin: Track = {
  target: 'k1a',
  property: 'transform',
  keyframes: [
    { offset: 0, value: 'translate(5px, 5px) rotate(0deg) translate(-5px, -5px)', easing: 'cubic-bezier(0.42, 0, 0.58, 1)' },
    { offset: 1, value: 'translate(5px, 5px) rotate(90deg) translate(-5px, -5px)', easing: 'linear' },
  ],
};
const fade: Track = { target: 'k1a', property: 'opacity', keyframes: [{ offset: 0, value: '0', easing: 'linear' }, { offset: 1, value: '1', easing: 'linear' }] };
const dash: Track = { target: 'k2b', property: 'stroke-dashoffset', keyframes: [{ offset: 0, value: '40', easing: 'steps(4, end)' }, { offset: 1, value: '0', easing: 'linear' }] };
const ir = (tracks: Track[], iterations: IR['iterations'] = 'infinite'): IR => ({ duration: 2, iterations, tracks, notes: [] });

describe('css', () => {
  it('moves the wrapper and paints the element', () => {
    expect(selector('s1', spin)).toBe('[data-asg="s1"] [data-for="k1a"]');
    expect(selector('s1', dash)).toBe('[data-asg="s1"] [data-k="k2b"]');
  });

  it('plays every track on one shared clock, with per-keyframe easing', () => {
    const out = css(ir([spin, fade, dash]), 's1');
    expect(out).toContain('@keyframes s1-0{0%{transform:translate(5px, 5px) rotate(0deg) translate(-5px, -5px);animation-timing-function:cubic-bezier(0.42, 0, 0.58, 1)}100%{transform:');
    expect(out).toContain('[data-asg="s1"] [data-for="k1a"]{animation:s1-0 2s linear infinite both,s1-1 2s linear infinite both}');
    expect(out).toContain('[data-asg="s1"] [data-k="k2b"]{animation:s1-2 2s linear infinite both}');
    expect(css(ir([fade], 1), 's1')).toContain('linear 1 both');
  });

  it('adds stacked transforms, and says nothing where nothing stacks', () => {
    expect(css(ir([fade, spin, spin]), 's1')).toContain(
      '{animation:s1-0 2s linear infinite both,s1-1 2s linear infinite both,s1-2 2s linear infinite both;animation-composition:replace,add,add}',
    );
    expect(css(ir([fade, dash]), 's1')).not.toContain('animation-composition');
  });

  it('plays nothing under reduced motion', () => {
    const out = css(ir([fade]), 's1');
    const guard = out.indexOf('@media (prefers-reduced-motion:no-preference)');
    expect(guard).toBeGreaterThan(out.indexOf('@keyframes'));
    expect(out.indexOf('{animation:')).toBeGreaterThan(guard);
  });

  it('keeps a jump a jump, showing the later value at the instant', () => {
    const jump: Track = {
      target: 'k1a',
      property: 'opacity',
      keyframes: [
        { offset: 0, value: '0', easing: 'linear' },
        { offset: 0, value: '1', easing: 'linear' },
        { offset: 0.5, value: '1', easing: 'linear' },
        { offset: 0.5, value: '0', easing: 'linear' },
        { offset: 1, value: '0', easing: 'linear' },
      ],
    };
    expect(css(ir([jump]), 's1')).toContain('{0%{opacity:0}0.001%{opacity:1}49.999%{opacity:1}50%{opacity:0}100%{opacity:0}}');
  });

  it('refuses keys and values it did not generate', () => {
    expect(() => css(ir([{ ...fade, target: 'k1"]{}' }]), 's1')).toThrow();
    expect(() => css(ir([{ ...fade, keyframes: [{ offset: 0, value: '1}</style>', easing: 'linear' }] }]), 's1')).toThrow();
    expect(() => css(ir([{ ...fade, keyframes: [{ offset: 0, value: 'url(x)', easing: 'linear' }] }]), 's1')).toThrow();
    expect(() => css(ir([{ ...fade, property: 'opacity}body{display:none' as 'opacity' }]), 's1')).toThrow();
    expect(() => css({ ...ir([fade]), duration: NaN }, 's1')).toThrow();
  });

  it('scopes each file and animation apart', () => {
    expect(scopeOf('<svg/>', ir([fade]))).toMatch(/^s[0-9a-f]{8}$/);
    expect(scopeOf('<svg/>', ir([fade]))).not.toBe(scopeOf('<svg/>', ir([spin])));
  });
});

describe('frameCss', () => {
  it('writes the values at one moment as static rules on the same selectors', () => {
    expect(frameCss(ir([fade, dash]), 1, 's1')).toBe(
      '[data-asg="s1"] [data-for="k1a"]{opacity:0.5 !important}\n[data-asg="s1"] [data-k="k2b"]{stroke-dashoffset:20 !important}',
    );
  });

  it('writes stacked transforms as one list, in track order', () => {
    const half = 'translate(5px, 5px) rotate(45deg) translate(-5px, -5px)';
    expect(frameCss(ir([{ ...spin, keyframes: spin.keyframes.map((k) => ({ ...k, easing: 'linear' })) }, spin]), 1, 's1')).toBe(
      `[data-asg="s1"] [data-for="k1a"]{transform:${half} ${half} !important}`,
    );
  });
});

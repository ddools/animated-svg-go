import { expect, test } from 'vitest';
import { rewriteRefs } from '../../src/core/parse/rewrite';

const p = 'a1b2-';

test('ids and every local reference form get the prefix', () => {
  expect(rewriteRefs('id', 'grad', p)).toBe('a1b2-grad');
  expect(rewriteRefs('href', '#shape', p)).toBe('#a1b2-shape');
  expect(rewriteRefs('xlink:href', '#shape', p)).toBe('#a1b2-shape');
  expect(rewriteRefs('fill', 'url(#grad)', p)).toBe('url(#a1b2-grad)');
  expect(rewriteRefs('fill', "url( '#grad' ) red", p)).toBe("url( '#a1b2-grad' ) red");
  expect(rewriteRefs('fill', 'URL(#grad)', p)).toBe('URL(#a1b2-grad)');
  expect(rewriteRefs('style', 'fill:url("#a");mask:url(#b)', p)).toBe('fill:url("#a1b2-a");mask:url(#a1b2-b)');
  expect(rewriteRefs('aria-labelledby', 'title  desc', p)).toBe('a1b2-title a1b2-desc');
});

test('everything else is left alone', () => {
  expect(rewriteRefs('href', 'data:image/png;base64,AAAA', p)).toBe('data:image/png;base64,AAAA');
  expect(rewriteRefs('fill', '#ff0000', p)).toBe('#ff0000');
  expect(rewriteRefs('d', 'M0 0L1 1', p)).toBe('M0 0L1 1');
  expect(rewriteRefs('data-name', '#1 logo', p)).toBe('#1 logo');
});

test('only the prefix is inserted, so quoting is never changed', () => {
  // Re-tokenising this value would turn one quoted string into a local url() plus a remote one.
  const tricky = 'url("#a), url(http://evil.test/x")';
  expect(rewriteRefs('style', tricky, p)).toBe('url("#a1b2-a), url(http://evil.test/x")');
});

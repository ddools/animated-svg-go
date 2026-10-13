import { expect, test } from 'vitest';
import { optimise } from '../../src/core/parse/optimise';
import { PipelineError } from '../../src/core/parse/limits';

const svg = (body: string, attrs = 'viewBox="0 0 10 10"') =>
  `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ${attrs}>${body}</svg>`;

test('class styles are inlined, even when a selector matches many elements', () => {
  const out = optimise(svg('<style>.a{fill:#f00}</style><rect class="a"/><circle class="a"/>'));
  expect(out).not.toContain('<style');
  expect(out.match(/fill="#f00"/g)).toHaveLength(2);
});

test('structure the rewrite pass depends on is left alone', () => {
  const out = optimise(
    svg(
      '<title>Logo</title><defs><linearGradient id="grad"/></defs>' +
        '<g id="outer"><g id="inner" inkscape:label="Layer 1"><rect width="1.23456789" height="1"/>' +
        '<path d="M0 0L1 1"/><path d="M2 2L3 3"/></g></g>',
    ),
  );
  expect(out).toContain('viewBox="0 0 10 10"');
  expect(out).toContain('<title>Logo</title>');
  expect(out).toContain('id="grad"');
  expect(out).toContain('id="outer"');
  expect(out).toContain('id="inner"');
  expect(out).toContain('inkscape:label="Layer 1"');
  expect(out).toContain('1.23456789');
  expect(out.match(/<path/g)).toHaveLength(2);
  expect(out).toContain('<rect');
  expect(out).not.toContain('<!DOCTYPE');
  expect(out).not.toContain('<?xml');
});

test('malformed XML is rejected as not-svg', () => {
  expect(() => optimise('<svg><g></svg>')).toThrowError(PipelineError);
  expect(() => optimise('not an svg at all <')).toThrowError(PipelineError);
});

test('non-SVG elements are removed, prefixed attributes are kept', () => {
  const out = optimise(
    svg(
      '<d:case xmlns:d="http://example.test/d"><d:text xmlns="http://www.w3.org/1999/xhtml"><p>Notes</p></d:text></d:case>' +
        '<sodipodi:namedview xmlns:sodipodi="http://example.test/s"/>' +
        '<div xmlns="http://www.w3.org/1999/xhtml">html</div>' +
        '<g inkscape:label="Layer"><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg></g>',
    ),
  );
  expect(out).not.toMatch(/<d:|<p>|namedview|<div/);
  expect(out).toContain('inkscape:label="Layer"');
  expect(out).toContain('<rect');
});

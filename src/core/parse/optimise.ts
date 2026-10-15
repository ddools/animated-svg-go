import { optimize, type Config, type CustomPlugin, type XastElement } from 'svgo/browser';
import { LIMITS, PipelineError } from './limits';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Editor and test-suite metadata often embeds XHTML (`<p>` and friends) in its own namespace.
// The sanitiser parses as HTML, where such a tag closes the <svg> and takes the drawing with it.
// Remove every element that is not plain SVG here, while the file is still XML.
//
// It also enforces the element and depth caps here, off the main thread, so an oversized
// file is refused before the sanitiser has to walk it.
const dropForeignElements: CustomPlugin = {
  name: 'dropForeignElements',
  fn: () => {
    let count = 0;
    let depth = 0;
    return {
    element: {
      enter: (node, parent) => {
        if (++count > LIMITS.elements) {
          throw new PipelineError('too-many-elements', `More than ${LIMITS.elements} elements.`);
        }
        if (++depth > LIMITS.depth + 1) throw new PipelineError('too-deep', `Nested deeper than ${LIMITS.depth} levels.`);
        const xmlns = node.attributes.xmlns;
        if (node.name.includes(':') || (xmlns !== undefined && xmlns !== SVG_NS)) {
          parent.children = parent.children.filter((child) => child !== node);
        }
      },
      exit: () => {
        depth--;
      },
    },
    };
  },
};

/** Decimal places kept in numbers and path data. SVGOMG's default. */
const PRECISION = 3;
/** Attributes that are names, not numbers, even when they look like one. */
const TEXT_ATTRIBUTE = /^(id|data-.*|aria-.*|.*:.*)$/;

export type Optimised = {
  svg: string;
  /** CSS that could not be inlined (media queries, keyframes, @font-face) was thrown away. */
  styleDropped: boolean;
};

/** String in, string out. No DOM, so it runs in a worker. Throws on malformed XML. */
export function optimise(svg: string): Optimised {
  let styleDropped = false;

  // Whatever inlineStyles could not move onto elements goes here, not in the sanitiser.
  // A <style> element reaching the main thread is reported as a CSP violation the moment it is parsed.
  const dropLeftoverStyles: CustomPlugin = {
    name: 'dropLeftoverStyles',
    fn: () => ({
      element: {
        enter: (node, parent) => {
          // Any case: the sanitiser's HTML parser lowercases tag names.
          if (node.name.toLowerCase() !== 'style') return;
          styleDropped = true;
          parent.children = parent.children.filter((child) => child !== node);
        },
      },
    }),
  };

  // cleanupNumericValues rounds any attribute that looks like a number, so id="0123" would lose its
  // leading zero and every reference to it. Text-like attributes are set aside around the safe set.
  const kept = new Map<XastElement, Record<string, string>>();
  const keepText: CustomPlugin = {
    name: 'keepText',
    fn: () => ({
      element: {
        enter: (node) => {
          const text = Object.entries(node.attributes).filter(([name]) => TEXT_ATTRIBUTE.test(name));
          if (text.length) kept.set(node, Object.fromEntries(text));
        },
      },
    }),
  };
  const restoreText: CustomPlugin = {
    name: 'restoreText',
    fn: () => ({ element: { enter: (node) => void Object.assign(node.attributes, kept.get(node)) } }),
  };

  // Not preset-default: nothing here may add, remove, merge or reorder elements, rename IDs or drop
  // editor labels. Keys come from each element's position, so the rewrite pass depends on the structure.
  // The safe set below only rewrites values, after SVGOMG (https://github.com/jakearchibald/svgomg).
  const config: Config = {
    multipass: false,
    plugins: [
      dropForeignElements,
      'removeDoctype',
      'removeXMLProcInst',
      'removeComments',
      'removeMetadata',
      // Class-based fills must survive the <style> element being dropped.
      { name: 'inlineStyles', params: { onlyMatchedOnce: false, removeMatchedSelectors: true } },
      'convertStyleToAttrs',
      dropLeftoverStyles,
      keepText,
      'cleanupAttrs',
      'removeEmptyAttrs',
      'convertColors',
      // Absolute units stay as written: units.ts reads them.
      { name: 'cleanupNumericValues', params: { floatPrecision: PRECISION, convertToPx: false } },
      // Transforms stay on the element. Folding them into the path would move its box and pivot.
      { name: 'convertPathData', params: { floatPrecision: PRECISION, applyTransforms: false } },
      restoreText,
    ],
  };

  try {
    const { data } = optimize(svg, config);
    // Internal DTD entities are expanded here, so a small file can come out hundreds of times bigger (M7 security review).
    // Checked in the worker, so the blown-up string is never posted to the main thread. Characters, not bytes: cheap, and close enough.
    if (data.length > LIMITS.bytes) throw new PipelineError('too-large', `${data.length} characters once entities are expanded. The limit is ${LIMITS.bytes}.`);
    return { svg: data, styleDropped };
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError('not-svg', error instanceof Error ? error.message : String(error));
  }
}

import { optimize, type Config, type CustomPlugin } from 'svgo/browser';
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

// Not preset-default: nothing here may merge paths, collapse groups, rename IDs,
// round numbers or drop editor labels. The rewrite pass depends on the structure.
const config: Config = {
  multipass: false,
  plugins: [
    dropForeignElements,
    'removeDoctype',
    'removeXMLProcInst',
    'removeComments',
    'removeMetadata',
    // Class-based fills must survive the sanitiser dropping <style>.
    { name: 'inlineStyles', params: { onlyMatchedOnce: false, removeMatchedSelectors: true } },
    'convertStyleToAttrs',
  ],
};

/** String in, string out. No DOM, so it runs in a worker. Throws on malformed XML. */
export function optimise(svg: string): string {
  try {
    return optimize(svg, config).data;
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError('not-svg', error instanceof Error ? error.message : String(error));
  }
}

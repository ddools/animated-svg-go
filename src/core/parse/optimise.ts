import { optimize, type Config } from 'svgo/browser';
import { PipelineError } from './limits';

// Not preset-default: nothing here may merge paths, collapse groups, rename IDs,
// round numbers or drop editor labels. The rewrite pass depends on the structure.
const config: Config = {
  multipass: false,
  plugins: [
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
    throw new PipelineError('not-svg', error instanceof Error ? error.message : String(error));
  }
}

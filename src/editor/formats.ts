import { animatedSvg } from '../core/backends/css';
import { cssSnippet, jsSnippet } from '../core/backends/snippet';
import type { IR } from '../core/ir/types';

export type TextFormat = 'svg' | 'css' | 'js';

// Each export as one text. Snippets are HTML to paste, so they download as .html.
export const TEXT: Record<TextFormat, { label: string; hint: string; extension: string; type: string; make(svg: string, ir: IR): string }> = {
  svg: {
    label: 'Animated SVG',
    hint: 'One file. Works as an image or pasted inline.',
    extension: 'svg',
    type: 'image/svg+xml',
    make: animatedSvg,
  },
  css: {
    label: 'SVG + CSS',
    hint: 'Inline SVG and a style block. Keep the data attributes and IDs.',
    extension: 'html',
    type: 'text/html',
    make(svg, ir) {
      const out = cssSnippet(svg, ir);
      return `${out.svg}\n<style>\n${out.css}\n</style>`;
    },
  },
  js: {
    label: 'SVG + JS',
    hint: 'Inline SVG and a short script using the Web Animations API.',
    extension: 'html',
    type: 'text/html',
    make: jsSnippet,
  },
};

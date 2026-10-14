<script lang="ts">
  import { animatedSvg } from '../core/backends/css';
  import { cssSnippet, jsSnippet } from '../core/backends/snippet';
  import type { IR } from '../core/ir/types';
  import { playback } from './playback.svelte';
  import { editor } from './state.svelte';

  type Format = 'svg' | 'css' | 'js';

  // Each export as one text. Snippets are HTML to paste, so they download as .html.
  const FORMATS: Record<Format, { label: string; hint: string; extension: string; type: string; make(svg: string, ir: IR): string }> = {
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

  let format = $state<Format>('svg');
  let status = $state('');

  const ready = $derived(Boolean(playback.ir?.tracks.length));

  // Made on demand, not on every edit: on a large file the export check takes a while.
  function make(): string | null {
    try {
      return FORMATS[format].make(editor.result!.svg, playback.ir!);
    } catch {
      status = 'This export failed a safety check, so it was not made.';
      return null;
    }
  }

  function size(text: string) {
    const bytes = new TextEncoder().encode(text).length;
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }

  async function copy() {
    const text = make();
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      status = `Copied, ${size(text)}.`;
    } catch {
      status = "Couldn't reach the clipboard. Try Download instead.";
    }
  }

  function download() {
    const text = make();
    if (text === null) return;
    const { extension, type } = FORMATS[format];
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${editor.fileName.replace(/\.svg$/i, '') || 'drawing'}-animated.${extension}`;
    link.click();
    // After the click has started the download.
    setTimeout(() => URL.revokeObjectURL(url));
    status = `Downloaded, ${size(text)}.`;
  }
</script>

<section aria-labelledby="export-heading" class="flex flex-col gap-2">
  <h2 id="export-heading" class="font-bold">Export</h2>
  <label class="flex flex-col gap-1">
    <span class="opacity-70">Format</span>
    <select class="select select-sm" bind:value={format} onchange={() => (status = '')}>
      {#each Object.entries(FORMATS) as [value, { label }] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>
  <p class="text-xs opacity-70">{FORMATS[format].hint} Stops for visitors who ask for reduced motion.</p>
  <div class="flex gap-1">
    <button type="button" class="btn btn-sm btn-primary" disabled={!ready} onclick={download}>Download</button>
    <button type="button" class="btn btn-sm" disabled={!ready} onclick={copy}>Copy</button>
  </div>
  <p class="text-xs" role="status">{ready ? status : 'Add an effect to export.'}</p>
</section>

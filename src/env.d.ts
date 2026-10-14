/// <reference types="astro/client" />

interface Window {
  __asg?: {
    normalise: typeof import('./editor/pipeline').normaliseFile;
    editor: typeof import('./editor/state.svelte').editor;
    selection: typeof import('./editor/selection.svelte').selection;
    project: typeof import('./editor/project.svelte').project;
    playback: typeof import('./editor/playback.svelte').playback;
    mountRaw: (svg: string) => import('./editor/sandbox').Sandbox;
    exports: typeof import('./core/backends/css') &
      typeof import('./core/backends/snippet') &
      typeof import('./core/backends/sampler') &
      typeof import('./core/export/frames');
    encoders: () => Promise<typeof import('./core/export/video') & typeof import('./core/export/gif')>;
  };
}

// gifenc ships no types. Only what gif.ts uses.
declare module 'gifenc' {
  type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options: { palette?: Palette; delay?: number; repeat?: number }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array;
  };
}

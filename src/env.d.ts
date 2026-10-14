/// <reference types="astro/client" />

interface Window {
  __asg?: {
    normalise: typeof import('./editor/pipeline').normaliseFile;
    editor: typeof import('./editor/state.svelte').editor;
    selection: typeof import('./editor/selection.svelte').selection;
    mountRaw: (svg: string) => import('./editor/sandbox').Sandbox;
  };
}

/// <reference types="astro/client" />

interface Window {
  __asg?: {
    normalise: typeof import('./editor/pipeline').normaliseFile;
    editor: typeof import('./editor/state.svelte').editor;
    mountRaw: (svg: string) => import('./editor/sandbox').Sandbox;
  };
}

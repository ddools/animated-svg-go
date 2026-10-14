/// <reference types="astro/client" />

interface Window {
  __asg?: {
    normalise: typeof import('./editor/pipeline').normaliseFile;
    editor: typeof import('./editor/state.svelte').editor;
    selection: typeof import('./editor/selection.svelte').selection;
    project: typeof import('./editor/project.svelte').project;
    playback: typeof import('./editor/playback.svelte').playback;
    mountRaw: (svg: string) => import('./editor/sandbox').Sandbox;
  };
}

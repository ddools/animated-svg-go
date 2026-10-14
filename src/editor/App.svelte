<script lang="ts">
  import DropZone from './DropZone.svelte';
  import LayerTree from './LayerTree.svelte';
  import Overlay from './Overlay.svelte';
  import Panel from './Panel.svelte';
  import Sandbox from './Sandbox.svelte';
  import { loadFile, loadText } from './load';
  import { mount } from './sandbox';
  import { normaliseFile } from './pipeline';
  import { selection } from './selection.svelte';
  import { editor } from './state.svelte';

  // Test hooks. Only present in builds made with PUBLIC_E2E set, never in production.
  if (import.meta.env.PUBLIC_E2E) {
    window.__asg = {
      normalise: normaliseFile,
      editor,
      selection,
      // Puts markup in the sandbox without sanitising it, to test the sandbox on its own.
      mountRaw: (svg) => mount(document.querySelector('iframe')!, svg),
    };
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void loadFile(file);
  }

  function paste(event: ClipboardEvent) {
    const file = event.clipboardData?.files[0];
    if (file) return void loadFile(file);
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text.includes('<svg')) void loadText(text);
  }
</script>

<svelte:window ondragover={(event) => event.preventDefault()} ondrop={drop} onpaste={paste} />

<div class="flex h-screen flex-col">
  <header class="border-base-300 flex items-center gap-4 border-b px-4 py-2">
    <h1 class="text-lg font-bold">Animated SVG GO</h1>
    {#if editor.status === 'ready'}
      <span class="truncate text-sm opacity-70">{editor.fileName}</span>
      <span class="ml-auto"><DropZone compact /></span>
    {/if}
  </header>

  <main class="min-h-0 flex-1">
    {#if editor.status === 'ready' && editor.result}
      <div class="grid h-full grid-cols-[16rem_1fr_18rem]">
        <nav class="border-base-300 min-h-0 border-r" aria-label="Layers">
          {#if editor.inventory}
            {#key editor.inventory}<LayerTree />{/key}
          {/if}
        </nav>
        <div class="canvas min-h-0 p-6" data-testid="canvas">
          <div class="relative h-full">
            <Sandbox result={editor.result} />
            {#if editor.inventory}<Overlay />{/if}
          </div>
        </div>
        <aside class="border-base-300 min-h-0 overflow-y-auto border-l">
          {#if editor.inventory}<Panel />{/if}
        </aside>
      </div>
    {:else if editor.status === 'loading'}
      <div class="grid h-full place-items-center" role="status">
        <span class="loading loading-spinner loading-lg" aria-label="Reading your file"></span>
      </div>
    {:else}
      <DropZone />
    {/if}
  </main>
</div>

<style>
  /* Checkerboard, so transparent areas of the drawing are visible. */
  .canvas {
    background: repeating-conic-gradient(#0000000d 0% 25%, transparent 0% 50%) 0 0 / 20px 20px;
  }
</style>

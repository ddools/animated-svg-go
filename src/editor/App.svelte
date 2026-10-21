<script lang="ts">
  import { onMount } from 'svelte';
  import Bars from './Bars.svelte';
  import DropZone from './DropZone.svelte';
  import LayerTree from './LayerTree.svelte';
  import Markup from './Markup.svelte';
  import Overlay from './Overlay.svelte';
  import Panel from './Panel.svelte';
  import Sandbox from './Sandbox.svelte';
  import Timeline from './Timeline.svelte';
  import * as cssBackend from '../core/backends/css';
  import * as sampler from '../core/backends/sampler';
  import * as snippet from '../core/backends/snippet';
  import * as frames from '../core/export/frames';
  import { registerAgentTools } from './agent';
  import { host } from './host';
  import { loadFile, loadText } from './load';
  import { mount } from './sandbox';
  import { normaliseFile } from './pipeline';
  import { playback } from './playback.svelte';
  import { project } from './project.svelte';
  import { selection } from './selection.svelte';
  import { editor } from './state.svelte';

  // Test hooks. Only present in builds made with PUBLIC_E2E set, never in production.
  if (import.meta.env.PUBLIC_E2E) {
    window.__asg = {
      normalise: normaliseFile,
      editor,
      selection,
      project,
      playback,
      // Puts markup in the sandbox without sanitising it, to test the sandbox on its own.
      mountRaw: (svg) => mount(document.querySelector('iframe')!, svg),
      exports: { ...cssBackend, ...snippet, ...sampler, ...frames },
      // Loaded on demand, as the export panel loads them.
      encoders: async () => ({ ...(await import('../core/export/video')), ...(await import('../core/export/gif')) }),
      // Raster export timings for Der to run in real browsers. Loaded on demand.
      bench: async (options) => (await import('./bench')).bench(options),
    };
  }

  // Tools for AI agents in the browser, where WebMCP is supported.
  onMount(registerAgentTools);

  // Autosave. save() reads the spec, so this runs again on every change.
  $effect(() => {
    if (editor.status === 'ready') project.save();
  });

  let view = $state<'image' | 'markup'>('image');

  const FRAME = 1 / 30;

  /** Space, arrows, Home and End drive the playhead. Not while typing, choosing, or on a button or slider that uses the key. */
  function transport(event: KeyboardEvent) {
    // The layer tree and the curve handles use these keys themselves, and say so.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    const type = (target as HTMLInputElement).type;
    if (target.localName === 'select' || target.localName === 'textarea' || target.isContentEditable) return;
    if (target.localName === 'input' && !['checkbox', 'button', 'range'].includes(type)) return;
    // A focused range slider keeps its own arrows, Home and End.
    if (type === 'range' && event.key !== ' ') return;
    // Space presses a focused button and ticks a focused checkbox. Sliders in the page keep their arrows.
    if (event.key === ' ' && (target.localName === 'button' || type === 'checkbox')) return;
    if (target.getAttribute('role') === 'slider' && event.key !== ' ') return;
    const step = event.shiftKey ? 1 : FRAME;
    const to = {
      ' ': null,
      ArrowLeft: playback.time - step,
      ArrowRight: playback.time + step,
      Home: 0,
      End: project.spec.duration,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    if (to === null) return void (playback.playing ? playback.pause() : playback.play());
    playback.pause();
    playback.seek(Math.min(project.spec.duration, Math.max(0, to)));
  }

  function keydown(event: KeyboardEvent) {
    if (editor.status !== 'ready') return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return transport(event);
    // Text and number fields keep their own undo.
    const field = event.target as HTMLInputElement;
    if (field.localName === 'input' && !['range', 'checkbox'].includes(field.type)) return;
    event.preventDefault();
    if (event.shiftKey) project.redo();
    else project.undo();
  }

  // In VS Code the tab belongs to its file, so another drawing can't be dropped or pasted in.
  function drop(event: DragEvent) {
    event.preventDefault();
    if (host.kind !== 'web') return;
    const file = event.dataTransfer?.files[0];
    if (file) void loadFile(file);
  }

  function paste(event: ClipboardEvent) {
    if (host.kind !== 'web') return;
    // A paste into a text field is the field's. Without this, pasting markup into a layer name replaced the drawing.
    const target = event.target as HTMLElement;
    if (target.localName === 'input' || target.localName === 'textarea' || target.isContentEditable) return;
    const file = event.clipboardData?.files[0];
    if (file) return void loadFile(file);
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text.includes('<svg')) void loadText(text);
  }
</script>

<svelte:window ondragover={(event) => event.preventDefault()} ondrop={drop} onpaste={paste} onkeydown={keydown} />

<div class="flex h-screen flex-col">
  <header class="border-base-300 flex items-center gap-4 border-b px-4 py-2">
    <h1 class="flex items-center gap-2 text-lg font-bold">
      <!-- In VS Code there is no site to go back to, and the tab is tied to its file. -->
      {#if host.kind === 'web'}
        <a href="/" class="contents"><img src="/icon.svg" width="24" height="24" alt="" />Animated SVG GO</a>
      {:else}
        Animated SVG GO
      {/if}
    </h1>
    {#if editor.status === 'ready'}
      <span class="truncate text-sm opacity-70">{editor.fileName}</span>
      <span class="ml-auto flex gap-1">
        <button type="button" class="btn btn-sm btn-ghost" disabled={!project.past.length} onclick={() => project.undo()} title="Undo (⌘Z)">Undo</button>
        <button type="button" class="btn btn-sm btn-ghost" disabled={!project.future.length} onclick={() => project.redo()} title="Redo (⇧⌘Z)">Redo</button>
      </span>
      {#if host.kind === 'web'}<DropZone compact />{/if}
    {/if}
    {#if host.kind === 'web'}
      <nav class="flex gap-3 text-sm" class:ml-auto={editor.status !== 'ready'} aria-label="Site">
        <a class="link link-hover" href="/about">About</a>
        <a class="link link-hover" href="/privacy">Privacy</a>
      </nav>
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
        <div class="flex min-h-0 flex-col">
          <div role="tablist" class="tabs tabs-border tabs-sm border-base-300 border-b px-4">
            <button type="button" role="tab" class="tab text-base-content/80" class:tab-active={view === 'image'} aria-selected={view === 'image'} onclick={() => (view = 'image')}>Image</button>
            <button type="button" role="tab" class="tab text-base-content/80" class:tab-active={view === 'markup'} aria-selected={view === 'markup'} onclick={() => (view = 'markup')}>Markup</button>
          </div>
          <div class="canvas relative min-h-0 flex-1 p-6" data-testid="canvas">
            <div class="relative h-full">
              <Sandbox result={editor.result} />
              {#if editor.inventory}<Overlay />{/if}
            </div>
            <!-- Over the drawing, not instead of it: unmounting the sandbox would rebuild it on the way back. -->
            {#if view === 'markup'}
              <div class="bg-base-100 absolute inset-0 p-4"><Markup /></div>
            {/if}
          </div>
          <Timeline />
          <Bars />
        </div>
        <aside class="border-base-300 min-h-0 overflow-y-auto border-l">
          {#if editor.inventory}<Panel />{/if}
        </aside>
      </div>
    {:else if editor.status === 'loading' || (host.kind === 'vscode' && editor.status !== 'error')}
      <!-- VS Code sends the file after the editor mounts, so there is nothing to drop in the meantime. -->
      <div class="grid h-full place-items-center" role="status">
        <span class="loading loading-spinner loading-lg" aria-label="Reading your file"></span>
      </div>
    {:else if host.kind === 'vscode'}
      <p role="alert" class="alert alert-error m-6">{editor.error}</p>
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

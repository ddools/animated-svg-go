<script lang="ts">
  import { untrack } from 'svelte';
  import { buildInventory } from '../core/parse/inventory';
  import type { Normalised } from '../core/parse';
  import { playback } from './playback.svelte';
  import { project } from './project.svelte';
  import { mount } from './sandbox';
  import { editor } from './state.svelte';

  let { result }: { result: Normalised } = $props();
  let iframe: HTMLIFrameElement;
  let loaded = $state(false);

  // Firefox replaces a new iframe's first document when it finishes loading,
  // so wait for the load event before putting anything in it.
  $effect(() => {
    if (!loaded) return;
    const sandbox = mount(iframe, result.svg);
    editor.sandbox = sandbox;
    editor.inventory = buildInventory(sandbox.root, result.labels);
    // Untracked: attaching compiles the spec, and spec changes must not remount the drawing.
    const detach = untrack(() => playback.attach(sandbox));
    return () => {
      detach();
      sandbox.destroy();
    };
  });

  // Every spec change reaches the preview, at most once per frame.
  $effect(() => {
    void project.spec;
    playback.update();
  });
</script>

<!-- No allow-scripts: nothing inside can run. allow-same-origin lets the editor reach in.
     inert keeps keyboard focus from reaching links inside the drawing. -->
<iframe
  inert
  bind:this={iframe}
  onload={() => (loaded = true)}
  sandbox="allow-same-origin"
  title="Your SVG"
  tabindex="-1"
  class="pointer-events-none h-full w-full"
></iframe>

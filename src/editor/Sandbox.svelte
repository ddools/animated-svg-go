<script lang="ts">
  import { untrack } from 'svelte';
  import { buildInventory } from '../core/parse/inventory';
  import { playback } from './playback.svelte';
  import { project } from './project.svelte';
  import { mount } from './sandbox';
  import { editor } from './state.svelte';

  import { selection } from './selection.svelte';

  let iframe: HTMLIFrameElement;
  let loaded = $state(false);

  // Firefox replaces a new iframe's first document when it finishes loading,
  // so wait for the load event before putting anything in it.
  $effect(() => {
    const drawing = project.drawing;
    if (!loaded || !drawing) return;
    const sandbox = mount(iframe, drawing.svg);
    editor.sandbox = sandbox;
    editor.inventory = buildInventory(sandbox.root, drawing.labels);
    // A structure edit or its undo can take selected layers away.
    untrack(() => selection.set([...selection.keys].filter((key) => editor.inventory!.nodes.has(key))));
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

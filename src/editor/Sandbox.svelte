<script lang="ts">
  import { buildInventory } from '../core/parse/inventory';
  import type { Normalised } from '../core/parse';
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
    return () => sandbox.destroy();
  });
</script>

<!-- No allow-scripts: nothing inside can run. allow-same-origin lets the editor reach in. -->
<iframe
  bind:this={iframe}
  onload={() => (loaded = true)}
  sandbox="allow-same-origin"
  title="Your SVG"
  tabindex="-1"
  class="pointer-events-none h-full w-full"
></iframe>

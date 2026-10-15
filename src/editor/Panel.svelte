<script lang="ts">
  import { selectParents, selectSamePaint, selectSameType, selectSiblings, selection } from './selection.svelte';
  import { project } from './project.svelte';
  import { editor } from './state.svelte';
  import Effects from './Effects.svelte';
  import Export, { bytes } from './Export.svelte';

  const WARNINGS: Record<string, string> = {
    'no-size': 'The file has no width, height or viewBox, so it is shown at 300 × 150.',
    'style-dropped': "Some of the file's CSS could not be kept: media queries, animations or fonts.",
  };

  // Measured in M7: past this, preview in headless Chromium drops below 30 fps. See ARCHITECTURE section 1.
  const BUSY = 5000;

  const inventory = $derived(editor.inventory!);
  const result = $derived(editor.result!);
  const nodes = $derived([...inventory.nodes.values()]);
  const shown = $derived(nodes.filter((node) => !node.referenced));
  const normalisedBytes = $derived(new TextEncoder().encode(result.svg).length);

  let gzipBytes = $state<number | null>(null);
  $effect(() => {
    const svg = result.svg;
    gzipBytes = null;
    const stream = new Blob([svg]).stream().pipeThrough(new CompressionStream('gzip'));
    void new Response(stream).arrayBuffer().then((buffer) => {
      if (svg === result.svg) gzipBytes = buffer.byteLength;
    });
  });

  const notes = $derived.by(() => {
    const out = result.warnings.map((code) => WARNINGS[code]).filter(Boolean);
    const count = (test: (type: string) => boolean) => shown.filter((node) => test(node.type)).length;
    const images = count((type) => type === 'image');
    const texts = count((type) => type === 'text');
    const filtered = shown.filter((node) => node.hasFilter).length;
    if (images) out.push(`${images} embedded ${images === 1 ? 'image' : 'images'}. Pixels can blur when scaled or rotated.`);
    if (texts) out.push(`${texts} text ${texts === 1 ? 'element uses' : 'elements use'} installed fonts. Exports may look different on machines without them.`);
    if (nodes.length > BUSY) out.push(`${nodes.length.toLocaleString('en-GB')} shapes. Preview can stutter on a file this big. GIF and MP4 frames are not affected.`);
    if (filtered) out.push(`${filtered} ${filtered === 1 ? 'element has' : 'elements have'} a filter. Filters can be slow to animate.`);
    return out;
  });

  const single = $derived.by(() => {
    if (selection.keys.size !== 1) return null;
    const [key] = selection.keys;
    const node = inventory.nodes.get(key)!;
    const box = inventory.measure(key)?.bbox;
    return { name: project.nameOf(node), type: node.type, size: box ? `${round(box.width)} × ${round(box.height)}` : '' };
  });

  function round(value: number) {
    return Math.round(value * 10) / 10;
  }
</script>

<div class="flex flex-col gap-6 p-4 text-sm">
  <section aria-labelledby="selection-heading" class="flex flex-col gap-2">
    <h2 id="selection-heading" class="font-bold">Selection</h2>
    {#if selection.keys.size === 0}
      <p class="opacity-70">Nothing selected. Click a shape, drag a box around some, or use the layer list.</p>
    {:else if single}
      <p data-testid="selection-summary"><span class="font-semibold">{single.name}</span> <span class="opacity-70">({single.type}, {single.size})</span></p>
    {:else}
      <p data-testid="selection-summary"><span class="font-semibold">{selection.keys.size}</span> selected</p>
    {/if}
    <div class="flex flex-wrap gap-1" role="group" aria-label="Select more like this">
      <button type="button" class="btn btn-xs" disabled={!selection.keys.size} onclick={selectSameType}>Same type</button>
      <button type="button" class="btn btn-xs" disabled={!selection.keys.size} onclick={() => selectSamePaint('fill')}>Same fill</button>
      <button type="button" class="btn btn-xs" disabled={!selection.keys.size} onclick={() => selectSamePaint('stroke')}>Same stroke</button>
      <button type="button" class="btn btn-xs" disabled={!selection.keys.size} onclick={selectSiblings}>Siblings</button>
      <button type="button" class="btn btn-xs" disabled={!selection.keys.size} onclick={selectParents}>Parent group</button>
      <button type="button" class="btn btn-xs btn-ghost" disabled={!selection.keys.size} onclick={() => selection.clear()}>Clear</button>
    </div>
  </section>

  <Effects />

  <Export />

  <section aria-labelledby="file-heading" class="flex flex-col gap-2">
    <h2 id="file-heading" class="font-bold">File</h2>
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" data-testid="file-info">
      <dt class="opacity-70">Original</dt>
      <dd>{bytes(editor.originalBytes)}</dd>
      <dt class="opacity-70">Prepared for animation</dt>
      <dd>{bytes(normalisedBytes)}</dd>
      <dt class="opacity-70">Gzipped</dt>
      <dd>{gzipBytes === null ? '…' : bytes(gzipBytes)}</dd>
      <dt class="opacity-70">Shapes and groups</dt>
      <dd>{shown.length}</dd>
      <dt class="opacity-70">Defined for reuse</dt>
      <dd>{nodes.length - shown.length}</dd>
    </dl>
    {#if notes.length}
      <ul class="flex flex-col gap-1" aria-label="Notes about this file">
        {#each notes as note (note)}
          <li class="alert alert-warning alert-soft px-3 py-2 text-xs">{note}</li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

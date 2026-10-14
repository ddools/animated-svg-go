<script lang="ts">
  import { leafNodes, selection } from './selection.svelte';
  import { editor } from './state.svelte';

  // Sits exactly over the sandbox iframe, so overlay coordinates are the iframe's viewport
  // coordinates. Takes all pointer input; nothing is ever attached inside the sandbox.

  // Beyond this many outlines the canvas is just a mass of boxes.
  const MAX_OUTLINES = 2000;
  // Below this a press on empty space is a click (clear), above it a lasso.
  const DRAG = 4;

  let width = $state(0);
  let height = $state(0);
  let overlay: SVGSVGElement;
  let lasso = $state<{ x0: number; y0: number; x: number; y: number } | null>(null);

  // Null for a missing or collapsed element, so it never draws a 0x0 outline or lassos.
  function rectOf(key: string) {
    const rect = editor.sandbox?.elementFor(key)?.getBoundingClientRect();
    return rect && rect.width + rect.height > 0 ? rect : null;
  }

  // Cmd and Shift add. Not Ctrl: on a Mac, Ctrl-click is a right-click.
  const additive = (event: PointerEvent) => event.shiftKey || event.metaKey;

  // width and height are read so outlines follow the drawing when the canvas resizes.
  const hovered = $derived(width && height && selection.hovered ? rectOf(selection.hovered) : null);
  const outlines = $derived(
    width && height ? [...selection.keys].slice(0, MAX_OUTLINES).map(rectOf).filter((rect) => rect !== null) : [],
  );

  function point(event: PointerEvent) {
    const box = overlay.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function keyAt(x: number, y: number) {
    return editor.sandbox?.elementAt(x, y)?.getAttribute('data-k') ?? null;
  }

  function down(event: PointerEvent) {
    const { x, y } = point(event);
    const key = keyAt(x, y);
    if (key) {
      if (additive(event)) selection.toggle(key);
      else selection.set([key]);
      return;
    }
    overlay.setPointerCapture(event.pointerId);
    lasso = { x0: x, y0: y, x, y };
  }

  function move(event: PointerEvent) {
    const { x, y } = point(event);
    if (lasso) lasso = { ...lasso, x, y };
    else selection.hovered = keyAt(x, y);
  }

  function up(event: PointerEvent) {
    if (!lasso) return;
    const { x0, y0, x, y } = lasso;
    lasso = null;
    if (Math.abs(x - x0) < DRAG && Math.abs(y - y0) < DRAG) {
      if (!additive(event)) selection.clear();
      return;
    }
    const [left, right, top, bottom] = [Math.min(x0, x), Math.max(x0, x), Math.min(y0, y), Math.max(y0, y)];
    const hits = leafNodes()
      .filter((node) => {
        const rect = rectOf(node.key);
        return rect && rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
      })
      .map((node) => node.key);
    if (additive(event)) selection.add(hits);
    else selection.set(hits);
  }
</script>

<div class="absolute inset-0" bind:clientWidth={width} bind:clientHeight={height}>
  <svg
    bind:this={overlay}
    {width}
    {height}
    role="application"
    aria-label="Canvas. Click a shape to select it, or drag to lasso. The layer list does the same by keyboard."
    class="absolute inset-0 touch-none"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (lasso = null)}
    onlostpointercapture={() => (lasso = null)}
    onpointerleave={() => (selection.hovered = null)}
  >
    {#each outlines as rect, i (i)}
      <rect data-outline="selected" x={rect.x} y={rect.y} width={rect.width} height={rect.height} class="fill-primary/10 stroke-primary" stroke-width="1.5" />
    {/each}
    {#if hovered}
      <rect data-outline="hover" x={hovered.x} y={hovered.y} width={hovered.width} height={hovered.height} class="stroke-primary fill-none" stroke-width="1" stroke-dasharray="4 3" />
    {/if}
    {#if lasso}
      <rect
        data-outline="lasso"
        x={Math.min(lasso.x0, lasso.x)}
        y={Math.min(lasso.y0, lasso.y)}
        width={Math.abs(lasso.x - lasso.x0)}
        height={Math.abs(lasso.y - lasso.y0)}
        class="fill-primary/5 stroke-primary"
        stroke-dasharray="4 3"
      />
    {/if}
  </svg>
</div>

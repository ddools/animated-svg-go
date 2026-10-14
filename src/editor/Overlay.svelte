<script lang="ts">
  import { EFFECTS } from '../core/spec/schema';
  import { playback } from './playback.svelte';
  import { project } from './project.svelte';
  import { leafNodes, selection } from './selection.svelte';
  import { editor } from './state.svelte';

  // Sits exactly over the sandbox iframe, so overlay coordinates are the iframe's viewport
  // coordinates. Takes all pointer input; nothing is ever attached inside the sandbox.

  // Beyond this many outlines the canvas is just a mass of boxes.
  const MAX_OUTLINES = 2000;
  // Below this a press on empty space is a click (clear), above it a lasso.
  const DRAG = 4;
  // Pivot handles drawn for one effect.
  const MAX_HANDLES = 50;

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

  // width, height and the playhead are read so outlines follow the drawing when it resizes or moves.
  // While playing they would lag behind, so they hide.
  const still = $derived(width && height && !playback.playing && playback.time >= 0);
  const hovered = $derived(still && selection.hovered ? rectOf(selection.hovered) : null);
  const outlines = $derived(still ? [...selection.keys].slice(0, MAX_OUTLINES).map(rectOf).filter((rect) => rect !== null) : []);

  type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
  const through = (m: Matrix, x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });

  /** Where a target's pivot is drawn, and how to map the pointer back into its box. */
  function pivotSpace(key: string) {
    const wrapper = editor.sandbox?.elementFor(key)?.parentElement;
    const space = wrapper?.parentElement as unknown as SVGGraphicsElement | null;
    const box = editor.inventory?.measure(key)?.bbox;
    // The wrapper's parent: the pivot is fixed there whatever the animation is doing.
    const matrix = space?.getScreenCTM?.();
    return matrix && box ? { matrix, box } : null;
  }

  const active = $derived(project.spec.effects.find((effect) => effect.id === project.active));
  const handles = $derived.by(() => {
    if (!still || !active || !EFFECTS[active.type].transform) return [];
    const { fx, fy } = active.pivot ?? { fx: 0.5, fy: 0.5 };
    return active.targets.slice(0, MAX_HANDLES).flatMap((key) => {
      const space = pivotSpace(key);
      if (!space) return [];
      const { box, matrix } = space;
      return [{ key, ...through(matrix, box.x + fx * box.width, box.y + fy * box.height) }];
    });
  });

  let pivoting: string | null = null;

  function grabPivot(event: PointerEvent, key: string) {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    pivoting = key;
  }

  function movePivot(event: PointerEvent) {
    const space = pivoting && pivotSpace(pivoting);
    if (!space) return;
    const { x, y } = point(event);
    const local = through(space.matrix.inverse(), x, y);
    const { box } = space;
    const fraction = (value: number, start: number, size: number) => (size ? Math.min(1, Math.max(0, (value - start) / size)) : 0.5);
    const pivot = { fx: fraction(local.x, box.x, box.width), fy: fraction(local.y, box.y, box.height) };
    const id = project.active;
    project.drag((spec) => void (spec.effects.find((effect) => effect.id === id)!.pivot = pivot));
  }

  function dropPivot() {
    pivoting = null;
    project.settle();
  }

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
    <!-- Mouse only. The pivot sliders in the effect panel are the keyboard route. -->
    {#each handles as handle (handle.key)}
      <circle
        role="presentation"
        data-testid="pivot"
        cx={handle.x}
        cy={handle.y}
        r="6"
        class="fill-base-100 stroke-secondary cursor-move"
        stroke-width="2"
        onpointerdown={(event) => grabPivot(event, handle.key)}
        onpointermove={movePivot}
        onpointerup={dropPivot}
        onlostpointercapture={dropPivot}
      />
    {/each}
  </svg>
</div>

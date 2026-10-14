<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { InventoryNode } from '../core/parse/inventory';
  import { selection } from './selection.svelte';
  import { editor } from './state.svelte';

  // Rows are a fixed height so only the visible ones need to exist. Map files put
  // thousands of paths in one group.
  const ROW = 28;
  const OVERSCAN = 10;

  type Row = { node: InventoryNode; depth: number; kids: number };

  let expanded = $state.raw<ReadonlySet<string>>(new Set());
  let focused = $state(0);
  let scrollTop = $state(0);
  let viewport = $state(0);
  let list: HTMLDivElement;

  const inventory = $derived(editor.inventory!);

  function visibleChildren(node: InventoryNode): string[] {
    return node.children.filter((key) => !inventory.nodes.get(key)!.referenced);
  }

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const visit = (keys: string[], depth: number) => {
      for (const key of keys) {
        const node = inventory.nodes.get(key)!;
        if (node.referenced) continue;
        const kids = visibleChildren(node);
        out.push({ node, depth, kids: kids.length });
        if (expanded.has(key)) visit(kids, depth + 1);
      }
    };
    visit(inventory.roots, 0);
    return out;
  });

  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN));
  const last = $derived(Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW) + OVERSCAN));

  function name(node: InventoryNode): string {
    return node.label ?? node.type;
  }

  function setExpanded(key: string, open: boolean) {
    const next = new Set(expanded);
    if (open) next.add(key);
    else next.delete(key);
    expanded = next;
  }

  async function focusRow(index: number) {
    focused = Math.max(0, Math.min(rows.length - 1, index));
    const top = focused * ROW;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW > list.scrollTop + viewport) list.scrollTop = top + ROW - viewport;
    scrollTop = list.scrollTop;
    await tick();
    list.querySelector<HTMLElement>(`[data-index="${focused}"]`)?.focus({ preventScroll: true });
  }

  function choose(key: string, additive: boolean) {
    if (additive) selection.toggle(key);
    else selection.set([key]);
  }

  function keydown(event: KeyboardEvent) {
    const row = rows[focused];
    if (!row) return;
    const { key } = row.node;
    switch (event.key) {
      case 'ArrowDown':
        void focusRow(focused + 1);
        break;
      case 'ArrowUp':
        void focusRow(focused - 1);
        break;
      case 'Home':
        void focusRow(0);
        break;
      case 'End':
        void focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row.kids && !expanded.has(key)) setExpanded(key, true);
        else if (row.kids) void focusRow(focused + 1);
        break;
      case 'ArrowLeft':
        if (expanded.has(key)) setExpanded(key, false);
        else if (row.node.parent) void focusRow(rows.findIndex((r) => r.node.key === row.node.parent));
        break;
      case 'Enter':
      case ' ':
        choose(key, event.shiftKey);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // When one element is picked on the canvas, open its groups and bring its row into view.
  $effect(() => {
    const keys = selection.keys;
    if (keys.size !== 1) return;
    const [key] = keys;
    untrack(() => {
      const ancestors: string[] = [];
      for (let node = inventory.nodes.get(key); node?.parent; node = inventory.nodes.get(node.parent)) ancestors.push(node.parent);
      if (ancestors.some((ancestor) => !expanded.has(ancestor))) expanded = new Set([...expanded, ...ancestors]);
      void tick().then(() => {
        const index = rows.findIndex((row) => row.node.key === key);
        if (index < 0) return;
        focused = index;
        const top = index * ROW;
        if (top < list.scrollTop || top + ROW > list.scrollTop + viewport) {
          list.scrollTop = Math.max(0, top - viewport / 2);
          scrollTop = list.scrollTop;
        }
      });
    });
  });
</script>

<div
  bind:this={list}
  bind:clientHeight={viewport}
  onscroll={() => (scrollTop = list.scrollTop)}
  onkeydown={keydown}
  role="tree"
  aria-label="Layers"
  aria-multiselectable="true"
  tabindex="-1"
  class="relative h-full overflow-y-auto text-sm"
>
  <div style:height="{rows.length * ROW}px">
    {#each rows.slice(first, last) as row, offset (row.node.key)}
      {@const index = first + offset}
      {@const key = row.node.key}
      {@const isSelected = selection.keys.has(key)}
      <!-- The tree handles keys for every row (roving tabindex). -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={isSelected}
        aria-expanded={row.kids ? expanded.has(key) : undefined}
        aria-label={name(row.node)}
        data-index={index}
        data-key={key}
        tabindex={index === focused ? 0 : -1}
        onclick={(event) => {
          focused = index;
          choose(key, event.shiftKey || event.metaKey);
        }}
        onmouseenter={() => (selection.hovered = key)}
        onmouseleave={() => (selection.hovered = null)}
        class="absolute right-0 left-0 flex cursor-default items-center gap-1 pr-2 outline-offset-[-2px]"
        class:bg-primary={isSelected}
        class:text-primary-content={isSelected}
        class:hover:bg-base-200={!isSelected}
        style:top="{index * ROW}px"
        style:height="{ROW}px"
        style:padding-left="{row.depth * 14 + 4}px"
      >
        {#if row.kids}
          <button
            type="button"
            tabindex="-1"
            aria-hidden="true"
            class="w-4 shrink-0 text-xs opacity-70"
            onclick={(event) => {
              event.stopPropagation();
              setExpanded(key, !expanded.has(key));
            }}>{expanded.has(key) ? '▾' : '▸'}</button
          >
        {:else}
          <span class="w-4 shrink-0"></span>
        {/if}
        <span class="truncate">{name(row.node)}</span>
        <span class="ml-auto shrink-0 font-mono text-xs opacity-60">{row.node.type}{row.kids ? ` · ${row.kids}` : ''}</span>
      </div>
    {/each}
  </div>
</div>

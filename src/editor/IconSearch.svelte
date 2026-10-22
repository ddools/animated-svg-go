<script lang="ts">
  import { loadText } from './load';

  // Opt-in: nothing is sent until someone searches. The privacy page says what Iconify sees.
  const API = 'https://api.iconify.design';
  // Names go into URLs, so anything else in a reply is dropped.
  const NAME = /^[a-z0-9-]+:[a-z0-9-]+$/;

  type Box = { left?: number; top?: number; width?: number; height?: number };
  type Search = { icons?: unknown[]; collections?: Record<string, { name?: string; license?: { title?: string } }> };
  type IconSet = Box & { icons?: Record<string, Box & { body?: string }>; aliases?: Record<string, { parent?: string } & Record<string, unknown>> };
  type Icon = { prefix: string; name: string; label: string; svg: string };

  let query = $state('');
  let searched = $state('');
  let icons = $state<Icon[]>([]);
  let busy = $state(false);
  let problem = $state('');

  const get = async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  };

  /** A whole SVG from Iconify's JSON. No width or height: the rewrite pass drops them anyway. */
  function build(set: IconSet, name: string): string | undefined {
    // Only an alias that is an exact copy. A flipped or rotated one would need its transform drawn.
    const alias = set.aliases?.[name];
    const icon = set.icons?.[alias && Object.keys(alias).length === 1 ? (alias.parent ?? '') : name];
    // Already animated with SMIL, which the sanitiser strips. Shapes it fades in would stay hidden.
    if (!icon?.body || /<(animate|set)/i.test(icon.body)) return;
    const [left, top, width, height] = [icon.left ?? set.left ?? 0, icon.top ?? set.top ?? 0, icon.width ?? set.width ?? 16, icon.height ?? set.height ?? 16].map(Number);
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}">${icon.body}</svg>`;
  }

  async function search(event: SubmitEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    busy = true;
    problem = '';
    try {
      const reply = await get<Search>(`/search?query=${encodeURIComponent(q)}&limit=64`);
      const byPrefix = new Map<string, string[]>();
      for (const icon of reply.icons ?? []) {
        if (typeof icon !== 'string' || !NAME.test(icon)) continue;
        const [prefix, name] = icon.split(':');
        byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
      }
      // One request per icon set, not one per icon: Iconify rate-limits, and a search can return 64.
      const sets = await Promise.all([...byPrefix].map(async ([prefix, names]) => [prefix, names, await get<IconSet>(`/${prefix}.json?icons=${names.join(',')}`)] as const));
      icons = sets.flatMap(([prefix, names, set]) =>
        names.flatMap((name) => {
          const svg = build(set, name);
          const info = reply.collections?.[prefix];
          return svg ? [{ prefix, name, svg, label: [name, info?.name, info?.license?.title].filter(Boolean).join(', ') }] : [];
        }),
      );
      searched = q;
    } catch {
      problem = "Couldn't reach the icon search. Check your connection.";
    } finally {
      busy = false;
    }
  }
</script>

<section class="mt-6 flex w-full max-w-xl flex-col gap-3" aria-labelledby="icon-search-heading">
  <h2 id="icon-search-heading" class="font-bold">No SVG to hand? Search free icons</h2>
  <form class="join w-full" role="search" onsubmit={search}>
    <input type="search" class="input join-item w-full" placeholder="Rocket, heart, sun…" aria-label="Search icons" bind:value={query} />
    <button type="submit" class="btn btn-primary join-item" disabled={busy}>Search</button>
  </form>
  {#if problem}
    <p role="alert" class="alert alert-error">{problem}</p>
  {:else if searched && !icons.length}
    <p role="status">No icons found for “{searched}”.</p>
  {/if}
  {#if icons.length}
    <ul class="grid grid-cols-8 gap-2" aria-label="Icons">
      {#each icons as icon (`${icon.prefix}:${icon.name}`)}
        <li>
          <!-- The same path as an upload: Iconify is as untrusted as any file. -->
          <button type="button" class="btn btn-ghost h-auto w-full bg-white p-2" aria-label={icon.label} title={icon.label} onclick={() => loadText(icon.svg, `${icon.prefix}-${icon.name}.svg`)}>
            <!-- An SVG in <img> can't run script or fetch anything. -->
            <img src="data:image/svg+xml,{encodeURIComponent(icon.svg)}" alt="" width="32" height="32" />
          </button>
        </li>
      {/each}
    </ul>
    <p class="text-sm opacity-70">
      Icons from <a class="link" href="https://iconify.design">Iconify</a>. Each set has its own licence, shown when you hover or focus an icon.
    </p>
  {/if}
</section>

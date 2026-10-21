<script lang="ts" module>
  import { TEXT, type TextFormat } from './formats';
  import { host } from './host';

  type RasterFormat = 'gif' | 'mp4';
  type Format = TextFormat | RasterFormat;

  export function bytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<script lang="ts">
  import { MAX_SECONDS, rasterSize, type FrameOptions } from '../core/export/frames';
  import { playback } from './playback.svelte';
  import { editor } from './state.svelte';

  // GIF stops at 720: bigger GIFs get huge and slow for little gain.
  const RASTER: Record<RasterFormat, { label: string; hint: string; extension: string; widths: number[] }> = {
    gif: { label: 'GIF', hint: 'Plays anywhere an image does. 256 colours, so smooth gradients may band.', extension: 'gif', widths: [480, 720] },
    mp4: { label: 'MP4 video', hint: 'Small and sharp. Plays in browsers, video players and slides.', extension: 'mp4', widths: [480, 720, 1080] },
  };
  const FRAME_RATES = [15, 24, 30];
  const OPTIONS = [...Object.entries(TEXT), ...Object.entries(RASTER)].map(([value, { label }]) => ({ value, label }));

  let format = $state<Format>('svg');
  let status = $state('');
  let width = $state(720);
  let fps = $state(24);
  let background = $state('#ffffff');
  let progress = $state<{ done: number; count: number } | null>(null);
  let controller: AbortController | null = null;
  let mp4Supported = $state<boolean | null>(null);
  let estimate = $state<number | null>(null);

  const ready = $derived(Boolean(playback.ir?.tracks.length));
  const raster = $derived(format === 'gif' || format === 'mp4' ? RASTER[format] : null);
  const viewBox = $derived(editor.sandbox?.root.viewBox.baseVal);
  const size = $derived(viewBox && viewBox.width > 0 ? rasterSize(viewBox, width) : null);
  const tooLong = $derived((playback.ir?.duration ?? 0) > MAX_SECONDS);
  const busy = $derived(progress !== null);
  const blocked = $derived(!ready || busy || (raster !== null && (tooLong || !size || (format === 'mp4' && mp4Supported === false))));

  function chooseFormat() {
    status = '';
    // Keep the width one the new format offers.
    if (raster && !raster.widths.includes(width)) width = raster.widths.at(-1)!;
  }

  // Whether this browser can encode H.264 at this size. Loads the encoder only once MP4 is picked.
  $effect(() => {
    if (format !== 'mp4' || !size) return;
    const asked = size;
    let current = true;
    mp4Supported = null;
    import('../core/export/video')
      .then(({ canExportMp4 }) => canExportMp4(asked))
      .then((supported) => current && (mp4Supported = supported))
      .catch(() => current && (mp4Supported = false));
    return () => (current = false);
  });

  /** Everything a raster export needs, read now so an edit during the export changes nothing. */
  function frameOptions(signal?: AbortSignal): FrameOptions | null {
    if (!editor.result || !playback.ir || !size) return null;
    return { svg: editor.result.svg, ir: playback.ir, size, fps, background, signal };
  }

  // A GIF size estimate, after the settings or the animation stop changing for a moment.
  $effect(() => {
    estimate = null;
    if (format !== 'gif' || !ready || tooLong) return;
    const controller = new AbortController();
    const options = frameOptions(controller.signal);
    if (!options) return;
    const timer = setTimeout(async () => {
      try {
        const { estimateGif } = await import('../core/export/gif');
        estimate = await estimateGif(options);
      } catch {
        // Superseded or refused. The export itself reports a refusal.
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  async function save(blob: Blob, extension: string) {
    const name = `${editor.fileName.replace(/\.svg$/i, '') || 'drawing'}-animated.${extension}`;
    if (await host.save(blob, name)) status = `${host.kind === 'web' ? 'Downloaded' : 'Saved'}, ${bytes(blob.size)}.`;
  }

  const refused = 'This export failed a safety check, so it was not made.';

  // Made on demand, not on every edit: on a large file the export check takes a while.
  function make(): string | null {
    try {
      return TEXT[format as TextFormat].make(editor.result!.svg, playback.ir!);
    } catch {
      status = refused;
      return null;
    }
  }

  async function copy() {
    const text = make();
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      status = `Copied, ${bytes(new TextEncoder().encode(text).length)}.`;
    } catch {
      status = "Couldn't reach the clipboard. Try Download instead.";
    }
  }

  async function renderAndSave(kind: RasterFormat) {
    controller = new AbortController();
    const options = frameOptions(controller.signal);
    if (!options) return;
    status = '';
    progress = { done: 0, count: 0 };
    const onProgress = (done: number, count: number) => (progress = { done, count });
    try {
      const blob =
        kind === 'gif'
          ? await (await import('../core/export/gif')).exportGif(options, onProgress)
          : await (await import('../core/export/video')).exportMp4(options, onProgress);
      await save(blob, RASTER[kind].extension);
    } catch (error) {
      if (controller.signal.aborted) status = 'Cancelled.';
      else if (error instanceof Error && error.message.startsWith('Export refused')) status = refused;
      else status = `Couldn't make the ${RASTER[kind].label}. Try a smaller size or a lower frame rate.`;
    } finally {
      progress = null;
      controller = null;
    }
  }

  function download() {
    if (format === 'gif' || format === 'mp4') {
      void renderAndSave(format);
      return;
    }
    const text = make();
    if (text === null) return;
    void save(new Blob([text], { type: TEXT[format].type }), TEXT[format].extension);
  }

  const hint = $derived(raster ? raster.hint : TEXT[format as TextFormat].hint);
  const note = $derived.by(() => {
    if (!ready) return 'Add an effect to export.';
    if (raster && tooLong) return `GIF and MP4 take up to ${MAX_SECONDS} seconds. Shorten the timeline to export one.`;
    if (format === 'mp4' && mp4Supported === false) return "This browser can't make MP4 files. Try GIF, or Chrome or Safari 26.";
    return status;
  });
</script>

<section aria-labelledby="export-heading" class="flex flex-col gap-2">
  <h2 id="export-heading" class="font-bold">Export</h2>
  <label class="flex flex-col gap-1">
    <span class="opacity-70">Format</span>
    <select class="select select-sm" bind:value={format} onchange={chooseFormat} disabled={busy}>
      {#each OPTIONS as { value, label } (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>
  <p class="text-xs opacity-70">
    {hint}
    {raster ? "Video and GIF can't stop for visitors who ask for reduced motion." : 'Stops for visitors who ask for reduced motion.'}
  </p>

  {#if raster}
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1">
        <span class="opacity-70">Width</span>
        <select class="select select-sm" bind:value={width} disabled={busy}>
          {#each raster.widths as option (option)}
            <option value={option}>{option} px</option>
          {/each}
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="opacity-70">Frame rate</span>
        <select class="select select-sm" bind:value={fps} disabled={busy}>
          {#each FRAME_RATES as option (option)}
            <option value={option}>{option} fps</option>
          {/each}
        </select>
      </label>
    </div>
    <label class="flex items-center gap-2">
      <input type="color" class="h-7 w-10 cursor-pointer" bind:value={background} disabled={busy} />
      <span class="opacity-70">Background</span>
    </label>
    {#if size}
      <p class="text-xs opacity-70" data-testid="raster-summary">
        {size.width} × {size.height} px.{#if format === 'gif'}
          {estimate === null ? ' Working out the size…' : ` About ${bytes(estimate)}.`}{/if}
      </p>
    {/if}
  {/if}

  {#if progress}
    <div class="flex items-center gap-2">
      <progress class="progress progress-primary w-full" value={progress.done} max={progress.count || 1} aria-label="Export progress"></progress>
      <button type="button" class="btn btn-sm" onclick={() => controller?.abort()}>Cancel</button>
    </div>
  {:else}
    <div class="flex gap-1">
      <button type="button" class="btn btn-sm btn-primary" disabled={blocked} onclick={download}>Download</button>
      {#if !raster}
        <button type="button" class="btn btn-sm" disabled={blocked} onclick={copy}>Copy</button>
      {/if}
    </div>
  {/if}
  <p class="text-xs" role="status">{note}</p>
</section>

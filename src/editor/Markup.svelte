<script lang="ts">
  import { animatedSvg } from '../core/backends/css';
  import { playback } from './playback.svelte';
  import { project } from './project.svelte';

  // Past this, colouring makes too many nodes to stay quick. Shown plain instead.
  const COLOUR_LIMIT = 300_000;
  // Tag names, attribute names, quoted values, tag ends. Text is never parsed as markup, only split into spans.
  const TOKEN = /(<\/?[\w:.-]+)|([\w:.-]+)(?==")|("[^"]*")|(\/?>)/g;
  // Tailwind's 700 and 300 shades pass 4.5:1 on the light and dark base. daisyUI's secondary and accent don't.
  const CLASSES = ['', 'text-indigo-700 dark:text-indigo-300', 'text-pink-700 dark:text-pink-300', 'text-teal-700 dark:text-teal-300', 'text-indigo-700 dark:text-indigo-300'];

  let text = $state('');
  let copied = $state('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = 'Copied.';
    } catch {
      copied = "Couldn't reach the clipboard.";
    }
  }

  // What Download gives for Animated SVG. Built a moment after edits stop: on a large file it takes a while.
  $effect(() => {
    const svg = project.drawing?.svg;
    const ir = playback.ir;
    if (!svg) return;
    const timer = setTimeout(() => {
      try {
        text = ir ? animatedSvg(svg, ir) : svg;
      } catch {
        text = 'This export failed a safety check, so it was not made.';
      }
    }, 200);
    return () => clearTimeout(timer);
  });

  const tokens = $derived.by(() => {
    if (text.length > COLOUR_LIMIT) return [{ s: text, c: '' }];
    const out: { s: string; c: string }[] = [];
    let last = 0;
    for (const match of text.matchAll(TOKEN)) {
      if (match.index > last) out.push({ s: text.slice(last, match.index), c: '' });
      out.push({ s: match[0], c: CLASSES[match.slice(1).findIndex(Boolean) + 1] });
      last = match.index + match[0].length;
    }
    out.push({ s: text.slice(last), c: '' });
    return out;
  });
</script>

<div class="flex h-full flex-col">
  <div class="flex items-center gap-2 pb-2">
    <button type="button" class="btn btn-xs" disabled={!text} onclick={copy}>Copy</button>
    <span class="text-xs" role="status">{copied}</span>
  </div>
  <p class="text-xs opacity-70">
    <span data-testid="markup-size">{new TextEncoder().encode(text).length.toLocaleString()} bytes.</span>
    Tidied on the way in with <a class="link" href="https://github.com/svg/svgo" target="_blank" rel="noopener">SVGO</a>, the safe parts of what
    <a class="link" href="https://jakearchibald.github.io/svgomg/" target="_blank" rel="noopener">SVGOMG</a> does. Thanks, Jake Archibald.
  </p>
  <pre class="min-h-0 flex-1 overflow-auto font-mono text-xs break-all whitespace-pre-wrap" data-testid="markup"
    >{#each tokens as token, i (i)}<span class={token.c}>{token.s}</span>{/each}</pre
  >
</div>

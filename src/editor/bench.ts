// Raster export bench (PLAN Stage 6 item 7). Test builds only: reached through window.__asg.bench().
// Der runs it in real Chrome and Safari; the numbers set the caps in core/export/frames.ts.
import { rasterSize } from '../core/export/frames';
import type { Spec } from '../core/spec/schema';
import { loadText } from './load';
import { playback } from './playback.svelte';
import { project } from './project.svelte';
import { editor } from './state.svelte';

export type BenchRow = {
  format: 'mp4' | 'gif';
  width: number;
  height: number;
  frames: number;
  /** Wall time for the whole export, encoder included. */
  seconds: number;
  msPerFrame: number;
  megabytes: number;
  /** Longest gap between animation frames while it ran: how long the UI froze at worst. */
  worstStallMs: number;
};

const VIEWBOX = { width: 400, height: 225 };
const CASES = [
  { format: 'mp4', width: 720 },
  { format: 'mp4', width: 1080 },
  { format: 'gif', width: 480 },
  { format: 'gif', width: 720 },
] as const;

/** 200 shapes, each spinning and fading, as in the M6 headless measurements. */
const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}">${Array.from(
  { length: 200 },
  (_, i) => `<rect x="${(i % 20) * 20 + 2}" y="${Math.floor(i / 20) * 22 + 2}" width="15" height="15" fill="hsl(${i * 1.8} 70% 50%)"/>`,
).join('')}</svg>`;

const nextFrame = () => new Promise<number>(requestAnimationFrame);

/** Loads the fixture, animates it for `seconds`, and times each export at `fps`. Logs a table and returns the rows. */
export async function bench({ seconds = 5, fps = 30 } = {}): Promise<BenchRow[]> {
  await loadText(FIXTURE, 'bench.svg');
  while (!editor.inventory) await nextFrame();
  const targets = [...editor.inventory.nodes.values()].filter((node) => node.type === 'rect').map((node) => node.key);
  const timing = { start: 0, duration: seconds, easing: { kind: 'cubic', p: [0.42, 0, 0.58, 1] }, iterations: 1, direction: 'normal' } as const;
  project.edit((spec) =>
    Object.assign(spec, {
      duration: seconds,
      loop: true,
      effects: [
        { id: 'bench-spin', type: 'spin', targets, params: { degrees: 360 }, timing },
        { id: 'bench-fade', type: 'fade', targets, params: { from: 1, to: 0.2 }, timing },
      ],
    } as Partial<Spec>),
  );
  playback.refresh();
  const svg = editor.result!.svg;
  const ir = playback.ir!;
  const { canExportMp4, exportMp4, exportGif } = { ...(await import('../core/export/video')), ...(await import('../core/export/gif')) };

  const rows: BenchRow[] = [];
  for (const { format, width } of CASES) {
    const size = rasterSize(VIEWBOX, width);
    if (format === 'mp4' && !(await canExportMp4(size))) continue;
    let worst = 0;
    let watching = true;
    void (async () => {
      let last = await nextFrame();
      while (watching) {
        const now = await nextFrame();
        worst = Math.max(worst, now - last);
        last = now;
      }
    })();
    let frames = 0;
    const options = { svg, ir, size, fps, background: '#ffffff' };
    const onProgress = (done: number) => void (frames = done);
    const start = performance.now();
    const blob = await (format === 'mp4' ? exportMp4(options, onProgress) : exportGif(options, onProgress));
    const ms = performance.now() - start;
    watching = false;
    rows.push({
      format,
      ...size,
      frames,
      seconds: round(ms / 1000),
      msPerFrame: round(ms / frames),
      megabytes: round(blob.size / 1e6),
      worstStallMs: Math.round(worst),
    });
  }
  console.table(rows);
  return rows;
}

const round = (n: number) => Math.round(n * 100) / 100;

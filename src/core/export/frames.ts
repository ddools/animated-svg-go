// Raster frames for GIF and MP4. See docs/ARCHITECTURE.md section 5.
// Uses the DOM only when called, never at import.
import { checkedExport, scopeOf, withStyle } from '../backends/css';
import { frameCss } from '../backends/sampler';
import type { IR } from '../ir/types';

export type Size = { width: number; height: number };

export type FrameOptions = {
  svg: string;
  ir: IR;
  size: Size;
  fps: number;
  /** A CSS colour painted under every frame. MP4 has no alpha. */
  background: string;
  signal?: AbortSignal;
  /** Draw only these moments instead of the whole pass. The GIF size estimate samples a few. */
  times?: number[];
};

/**
 * Seconds at which to draw one pass of the timeline. A loop leaves out its end, which is its start again.
 * A timeline that plays once keeps it, so the last frame shows where it stops.
 */
export function frameTimes(duration: number, fps: number, loop: boolean): number[] {
  if (!(duration > 0 && fps > 0 && Number.isFinite(duration * fps))) throw new Error(`Unexpected duration or fps: ${duration}, ${fps}`);
  const count = Math.max(1, Math.round(duration * fps));
  const times = Array.from({ length: count }, (_, i) => (i * duration) / count);
  return loop ? times : [...times, duration];
}

/** Seconds between frames: one pass spread evenly, so not always exactly 1 / fps. */
export const frameStep = (duration: number, fps: number): number => duration / Math.max(1, Math.round(duration * fps));

// Safari has no scheduler.yield.
const yieldToUi = (): Promise<void> => globalThis.scheduler?.yield?.() ?? new Promise((resolve) => setTimeout(resolve));

/**
 * Draws each frame on one canvas and hands it to `onFrame`, which must finish with it before the next is drawn.
 * Nothing is held between frames. The file is checked once; each frame only adds its own checked style.
 * Main thread on purpose: Safari decodes SVG images there. Cancel with `signal`; it rejects with the abort reason.
 */
export async function renderFrames(
  { svg, ir, size, fps, background, signal, times = frameTimes(ir.duration, fps, ir.iterations === 'infinite') }: FrameOptions,
  onFrame: (canvas: HTMLCanvasElement, index: number, count: number) => void | Promise<void>,
): Promise<void> {
  const scope = scopeOf(svg, ir);
  const checked = checkedExport(svg, scope);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  // GIF reads every frame back.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas.');

  for (const [i, t] of times.entries()) {
    signal?.throwIfAborted();
    const url = URL.createObjectURL(new Blob([withStyle(checked, frameCss(ir, t, scope))], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      // Measured ready to paint in Chromium and WebKit, embedded rasters included (ARCHITECTURE section 5).
      await img.decode();
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(img, 0, 0, size.width, size.height);
    } finally {
      URL.revokeObjectURL(url);
    }
    await onFrame(canvas, i, times.length);
    await yieldToUi();
  }
}

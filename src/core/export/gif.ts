// GIF export: frames from the loop, quantised and encoded by gifenc. See docs/ARCHITECTURE.md section 5.
// Uses the DOM only when called, never at import.
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { frameStep, frameTimes, renderFrames, type FrameOptions } from './frames';

// Frames the size estimate encodes, spread over the pass.
const SAMPLES = 3;

/**
 * Milliseconds frame `index` stays up. GIF counts in hundredths of a second, so each delay is rounded
 * from the running total: 30 fps alternates 30 and 40 ms and keeps time, where a flat 30 ms would run fast.
 */
export function gifDelay(index: number, step: number): number {
  return (Math.round((index + 1) * step * 100) - Math.round(index * step * 100)) * 10;
}

type Encoder = ReturnType<typeof GIFEncoder>;

/** Appends one canvas as a frame with its own 256-colour palette. Returns the bytes it added. */
function writeFrame(gif: Encoder, canvas: HTMLCanvasElement, delay: number, loop: boolean): number {
  const before = gif.bytesView().length;
  const { width, height } = canvas;
  // ponytail: quantised on the main thread. Move to a worker if it blocks the UI at the size caps.
  const { data } = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const palette = quantize(data, 256);
  // repeat 0 loops forever, -1 plays once. Only the first frame's is written.
  gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: loop ? 0 : -1 });
  return gif.bytesView().length - before;
}

/** One pass of the timeline as a GIF. Rejects with the abort reason if `options.signal` fires. */
export async function exportGif(options: FrameOptions, onProgress?: (done: number, count: number) => void): Promise<Blob> {
  const gif = GIFEncoder();
  const loop = options.ir.iterations === 'infinite';
  const step = frameStep(options.ir.duration, options.fps);
  await renderFrames(options, (canvas, index, count) => {
    writeFrame(gif, canvas, gifDelay(index, step), loop);
    onProgress?.(index + 1, count);
  });
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/** Bytes the GIF will take, from a few frames encoded the same way. */
export async function estimateGif(options: FrameOptions): Promise<number> {
  const all = frameTimes(options.ir.duration, options.fps, options.ir.iterations === 'infinite');
  const times = sampleTimes(all, SAMPLES);
  const gif = GIFEncoder();
  const sizes: number[] = [];
  await renderFrames({ ...options, times }, (canvas) => {
    sizes.push(writeFrame(gif, canvas, 0, true));
  });
  // The first frame also carries the header and loop block. Close enough at any real frame count.
  return Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * all.length);
}

/** `n` moments spread evenly through `times`, or all of them if there are fewer. */
export function sampleTimes(times: number[], n: number): number[] {
  if (times.length <= n) return times;
  return Array.from({ length: n }, (_, i) => times[Math.floor((i * times.length) / n)]);
}

// MP4 export: frames from the loop, H.264 through WebCodecs, muxed by Mediabunny. See docs/ARCHITECTURE.md section 5.
// Uses the DOM only when called, never at import.
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny';
import { frameStep, renderFrames, type FrameOptions, type Size } from './frames';

/** H.264 needs even sides. */
const isEven = ({ width, height }: Size) => width % 2 === 0 && height % 2 === 0;

/** Whether this browser can encode H.264 at this size. Safari before 26 and some Firefox builds can't. */
export async function canExportMp4(size: Size): Promise<boolean> {
  return isEven(size) && typeof VideoEncoder !== 'undefined' && canEncodeVideo('avc', { ...size, quality: QUALITY_HIGH });
}

/** One pass of the timeline as an MP4. Rejects with the abort reason if `options.signal` fires. */
export async function exportMp4(options: FrameOptions, onProgress?: (done: number, count: number) => void): Promise<Blob> {
  if (!isEven(options.size)) throw new Error(`MP4 needs even sides: ${options.size.width} x ${options.size.height}`);
  const target = new BufferTarget();
  // In-memory fast start puts the index first, so the file plays before it has fully loaded.
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const step = frameStep(options.ir.duration, options.fps);
  let source: CanvasSource | undefined;
  try {
    await renderFrames(options, async (canvas, index, count) => {
      if (!source) {
        // The loop makes its canvas, so the track starts with the first frame.
        source = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH });
        output.addVideoTrack(source, { frameRate: options.fps });
        await output.start();
      }
      // Awaited: the encoder's backpressure keeps frames from piling up in memory.
      await source.add(index * step, step);
      onProgress?.(index + 1, count);
    });
    await output.finalize();
  } catch (error) {
    if (output.state !== 'finalized') await output.cancel();
    throw error;
  }
  return new Blob([target.buffer!], { type: 'video/mp4' });
}

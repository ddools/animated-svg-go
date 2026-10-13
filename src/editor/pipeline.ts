import { LIMITS, normalise, PipelineError, type Normalised } from '../core/parse';
import type { PipelineErrorCode } from '../core/parse/limits';

type Reply = { ok: true; svg: string } | { ok: false; code: PipelineErrorCode; message: string };

// A fresh worker per file, so a hung SVGO run can simply be terminated.
function optimiseInWorker(svg: string): Promise<string> {
  const worker = new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PipelineError('timeout', 'This file took too long to process.')),
      LIMITS.optimiseMs,
    );
    worker.onmessage = (event: MessageEvent<Reply>) => {
      clearTimeout(timer);
      if (event.data.ok) resolve(event.data.svg);
      else reject(new PipelineError(event.data.code, event.data.message));
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      reject(new PipelineError('not-svg', event.message));
    };
    worker.postMessage(svg);
  }).finally(() => worker.terminate());
}

export const normaliseFile = (raw: string): Promise<Normalised> => normalise(raw, { optimise: optimiseInWorker });

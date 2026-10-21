import { normalise, type Normalised } from '../core/parse';
import { LIMITS, PipelineError, type PipelineErrorCode } from '../core/parse/limits';
import type { Optimised } from '../core/parse/optimise';
import { host } from './host';

type Reply = ({ ok: true } & Optimised) | { ok: false; code: PipelineErrorCode; message: string };

// A fresh worker per file, so a hung SVGO run can simply be terminated.
function optimiseInWorker(svg: string): Promise<Optimised> {
  const worker = host.worker();
  return new Promise<Optimised>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PipelineError('timeout', 'This file took too long to process.')),
      LIMITS.optimiseMs,
    );
    worker.onmessage = (event: MessageEvent<Reply>) => {
      clearTimeout(timer);
      if (event.data.ok) resolve({ svg: event.data.svg, styleDropped: event.data.styleDropped });
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

import { PipelineError } from '../core/parse/limits';
import { optimise } from '../core/parse/optimise';

self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ ok: true, ...optimise(event.data) });
  } catch (error) {
    const code = error instanceof PipelineError ? error.code : 'not-svg';
    self.postMessage({ ok: false, code, message: error instanceof Error ? error.message : String(error) });
  }
};

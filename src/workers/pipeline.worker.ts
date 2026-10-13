import { optimise } from '../core/parse/optimise';

self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ ok: true, svg: optimise(event.data) });
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};

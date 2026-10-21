// The editor island in a VS Code webview. See docs/ARCHITECTURE.md section 9.
import '../src/styles/global.css';
import { mount } from 'svelte';
import App from '../src/editor/App.svelte';
import { setHost } from '../src/editor/host';
import { fail, loadText } from '../src/editor/load';
import { editor } from '../src/editor/state.svelte';
import { LIMITS } from '../src/core/parse/limits';
import { SpecSchema } from '../src/core/spec/schema';
import workerUrl from '../src/workers/pipeline.worker.ts?worker&url';

export type VsCode = { postMessage(message: unknown): void };
declare function acquireVsCodeApi(): VsCode;
const vscode = acquireVsCodeApi();

type FromHost =
  | { type: 'open'; name: string; text: string; spec?: unknown; smoke?: string; tooLarge?: false }
  | { type: 'open'; name: string; tooLarge: true }
  | { type: 'saved'; id: number; ok: boolean };

// Webview scripts come from another origin than the document, and a plain worker from there fails to load.
// A blob URL is same-origin, so the worker's source is fetched once, before the editor can ask for one.
const workerBlob = URL.createObjectURL(new Blob([await (await fetch(workerUrl)).text()], { type: 'text/javascript' }));

// <a download> does nothing in a webview, so the extension saves the bytes. It answers once the dialog closes.
const saves = new Map<number, (ok: boolean) => void>();
let nextSave = 0;

setHost({
  kind: 'vscode',
  worker: () => new Worker(workerBlob, { type: 'module' }),
  async save(blob, name) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const id = nextSave++;
    return new Promise((resolve) => {
      saves.set(id, resolve);
      vscode.postMessage({ type: 'save', id, name, bytes });
    });
  },
  // The extension already has the file, so only the spec goes back.
  store: ({ spec }) => vscode.postMessage({ type: 'store', spec }),
});

// VS Code marks its theme on <body>. Daisy picks its theme from data-theme on <html>.
const light = () => ['vscode-light', 'vscode-high-contrast-light'].some((name) => document.body.classList.contains(name));
const theme = () => document.documentElement.setAttribute('data-theme', light() ? 'light' : 'dark');
theme();
new MutationObserver(theme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

mount(App, { target: document.body });

addEventListener('message', (event: MessageEvent<FromHost>) => {
  // Only the extension talks to us. Child frames (the sandbox) never may, even if layer 2 failed.
  // Not a window.parent check: VS Code's own script replaces it.
  for (let i = 0; i < frames.length; i++) if (event.source === frames[i]) return;
  const message = event.data;
  if (message.type === 'saved') {
    saves.get(message.id)?.(message.ok);
    saves.delete(message.id);
  } else if (message.type === 'open' && message.tooLarge) {
    editor.fileName = message.name;
    fail('too-large');
  } else if (message.type === 'open') {
    // Storage is not trusted: the spec goes back through the schema, as the site's autosave does.
    const spec = SpecSchema.safeParse(message.spec);
    void loadText(message.text, message.name, spec.success ? spec.data : undefined);
    if (message.smoke) void import('./checks').then(({ checks }) => checks(message.smoke!, vscode));
  }
});
// The extension checks the file against the editor's own cap before reading it.
vscode.postMessage({ type: 'ready', maxBytes: LIMITS.bytes });

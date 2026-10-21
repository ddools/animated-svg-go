// Spike: the editor island in a VS Code webview, plus the shims a webview needs and checks that report back.
import '../src/styles/global.css';
import { mount } from 'svelte';
import App from '../src/editor/App.svelte';
import { loadText } from '../src/editor/load';
import { playback } from '../src/editor/playback.svelte';
import { project } from '../src/editor/project.svelte';
import { editor } from '../src/editor/state.svelte';
import { newEffect } from '../src/core/spec/schema';
import workerUrl from '../src/workers/pipeline.worker.ts?worker&url';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

// Webview scripts come from another origin than the document, and a worker must be same-origin.
// A blob URL is, so the worker's source is fetched up front and the constructor swaps it in.
const workerFile = (url: string | URL) => String(url).split('/').pop()!;
const blobs = new Map<string, string>();
const workerSource = await fetch(workerUrl);
blobs.set(workerFile(workerUrl), URL.createObjectURL(new Blob([await workerSource.text()], { type: 'text/javascript' })));
let workersStarted = 0;
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    const blob = blobs.get(workerFile(url));
    if (blob) workersStarted++;
    super(blob ?? url, options);
  }
};

// <a download> does nothing in a webview. The extension saves the bytes instead.
const nativeClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  if (!this.download || !this.href.startsWith('blob:')) return nativeClick.call(this);
  const name = this.download;
  void fetch(this.href)
    .then((response) => response.arrayBuffer())
    .then((buffer) => vscode.postMessage({ type: 'save', name, bytes: new Uint8Array(buffer) }));
};

mount(App, { target: document.body });

type Check = { ok: boolean; detail: string };
const results: Record<string, Check> = {};
const files: { name: string; bytes: Uint8Array }[] = [];

async function check(name: string, run: () => Promise<string>) {
  try {
    results[name] = { ok: true, detail: await run() };
  } catch (error) {
    results[name] = { ok: false, detail: String(error) };
  }
}

async function until(test: () => boolean, what: string) {
  for (let waited = 0; waited < 15_000; waited += 50) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function runChecks() {
  await check('worker', async () => {
    await until(() => editor.status !== 'loading', 'the pipeline');
    if (editor.status === 'error') throw new Error(editor.error);
    return `pipeline ran, ${workersStarted} worker(s) from blob URLs`;
  });
  await check('sandbox', async () => {
    await until(() => editor.inventory !== undefined, 'the drawing to mount');
    const iframe = document.querySelector('iframe')!;
    const shapes = iframe.contentDocument!.querySelectorAll('[data-k]').length;
    if (!shapes) throw new Error('no shapes in the sandbox');
    return `contentDocument reachable, ${shapes} keyed elements, sandbox="${iframe.getAttribute('sandbox')}"`;
  });
  await check('scriptsBlocked', async () => {
    // A script inside the sandbox must not run. Run first, then look for its side effect.
    const doc = document.querySelector('iframe')!.contentDocument!;
    const script = doc.createElement('script');
    script.textContent = 'parent.__spikeEscaped = true';
    doc.body.append(script);
    script.remove();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if ((window as unknown as { __spikeEscaped?: boolean }).__spikeEscaped) throw new Error('script ran inside the sandbox');
    return 'script in the sandbox did not run';
  });
  await check('clipboard', async () => {
    await navigator.clipboard.writeText('Animated SVG GO spike');
    return 'navigator.clipboard.writeText worked';
  });

  const key = editor.inventory?.roots[0];
  if (key) {
    project.edit((spec) => void spec.effects.push(newEffect('spin', [key], 'spike')));
    await until(() => (playback.ir?.tracks.length ?? 0) > 0, 'the IR');
  }
  const options = () => ({ svg: editor.result!.svg, ir: playback.ir!, size: { width: 320, height: 320 }, fps: 30, background: '#ffffff' });
  await check('mp4', async () => {
    const { canExportMp4, exportMp4 } = await import('../src/core/export/video');
    if (!(await canExportMp4({ width: 320, height: 320 }))) throw new Error('canExportMp4 says no');
    const blob = await exportMp4(options());
    files.push({ name: 'spike.mp4', bytes: new Uint8Array(await blob.arrayBuffer()) });
    return `${blob.size} bytes`;
  });
  await check('gif', async () => {
    const { exportGif } = await import('../src/core/export/gif');
    const blob = await exportGif(options());
    files.push({ name: 'spike.gif', bytes: new Uint8Array(await blob.arrayBuffer()) });
    return `${blob.size} bytes`;
  });
  results.userAgent = { ok: true, detail: navigator.userAgent };
  vscode.postMessage({ type: 'results', results, files });
}

addEventListener('message', (event: MessageEvent<{ type: string; name: string; text: string }>) => {
  if (event.data.type !== 'open') return;
  void loadText(event.data.text, event.data.name);
  void runChecks();
});
vscode.postMessage({ type: 'ready' });

// What differs between the website and the VS Code extension (docs/ARCHITECTURE.md section 9).
// The extension swaps in its own host before the editor mounts.
import { set } from 'idb-keyval';

export const SAVE_KEY = 'project';

export type Saved = { fileName: string; text: string; spec: unknown };

export type Host = {
  kind: 'web' | 'vscode';
  /** The SVGO worker. A fresh one per file. */
  worker(): Worker;
  /** Hands a finished export to the person. False if they cancelled. */
  save(blob: Blob, name: string): Promise<boolean>;
  /** Autosave. Storage can be blocked, so failure just means nothing saved. */
  store(saved: Saved): void;
};

const web: Host = {
  kind: 'web',
  worker: () => new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), { type: 'module' }),
  async save(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    // After the click has started the download.
    setTimeout(() => URL.revokeObjectURL(url));
    return true;
  },
  store: (saved) => void set(SAVE_KEY, saved).catch(() => {}),
};

export let host: Host = web;

export function setHost(next: Host): void {
  host = next;
}

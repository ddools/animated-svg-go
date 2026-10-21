// pnpm ext:smoke only: checks the editor works inside the webview and reports to the extension. Never loaded otherwise.
import { newEffect } from '../src/core/spec/schema';
import { host } from '../src/editor/host';
import { playback } from '../src/editor/playback.svelte';
import { project } from '../src/editor/project.svelte';
import { editor } from '../src/editor/state.svelte';
import type { VsCode } from './webview';

type Check = { ok: boolean; detail: string };

async function until(test: () => boolean, what: string) {
  for (let waited = 0; waited < 15_000; waited += 50) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export async function checks(phase: string, vscode: VsCode): Promise<void> {
  const results: Record<string, Check> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      results[name] = { ok: true, detail: await run() };
    } catch (error) {
      results[name] = { ok: false, detail: String(error) };
    }
  };
  const effects = () => project.spec.effects.length;

  await check(`${phase}: opens`, async () => {
    await until(() => editor.status !== 'loading' && editor.status !== 'empty', 'the pipeline');
    if (editor.status === 'error') throw new Error(editor.error);
    await until(() => editor.inventory !== undefined, 'the drawing to mount');
    return `${editor.inventory!.nodes.size} layers`;
  });

  if (phase === 'restored') await check('restore', async () => {
    if (effects() !== 1) throw new Error(`${effects()} effects after reopening, expected 1`);
    return 'the effect came back';
  });
  if (phase === 'changed') await check('changed file', async () => {
    if (effects() !== 0) throw new Error(`${effects()} effects after the file changed, expected 0`);
    return 'a changed file starts fresh';
  });

  if (phase === 'checks') {
    await check('sandbox', async () => {
      const iframe = document.querySelector('iframe')!;
      const shapes = iframe.contentDocument!.querySelectorAll('[data-k]').length;
      if (!shapes) throw new Error('no shapes in the sandbox');
      return `contentDocument reachable, ${shapes} keyed elements, sandbox="${iframe.getAttribute('sandbox')}"`;
    });
    await check('scripts blocked', async () => {
      // A script inside the sandbox must not run. Insert one, then look for its side effect.
      const doc = document.querySelector('iframe')!.contentDocument!;
      const script = doc.createElement('script');
      script.textContent = 'parent.__smokeEscaped = true';
      doc.body.append(script);
      script.remove();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if ((window as { __smokeEscaped?: boolean }).__smokeEscaped) throw new Error('script ran inside the sandbox');
      return 'script in the sandbox did not run';
    });
    await check('page CSP inherited', async () => {
      // The sandbox has its own deny-all policy too. The page's is the one that names VS Code's resource host.
      const doc = document.querySelector('iframe')!.contentDocument!;
      const policies: string[] = [];
      doc.addEventListener('securitypolicyviolation', (event) => policies.push(event.originalPolicy));
      const image = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
      image.setAttribute('href', 'https://example.com/smoke.png');
      doc.querySelector('svg')!.append(image);
      await until(() => policies.some((policy) => policy.includes('vscode-resource')), 'a page CSP violation');
      image.remove();
      return `${policies.length} policies blocked a remote image, the page's among them`;
    });
    await check('clipboard', async () => {
      try {
        await navigator.clipboard.writeText('Animated SVG GO smoke');
      } catch (error) {
        // The clipboard needs OS focus, and the test window doesn't always get it. A person clicking Copy has it.
        if (error instanceof DOMException && error.message.includes('not focused')) return 'skipped: the test window had no focus';
        throw error;
      }
      return 'navigator.clipboard.writeText worked';
    });
    await check('save', async () => {
      if (!(await host.save(new Blob(['smoke']), 'save.txt'))) throw new Error('the extension did not save');
      return 'bytes reached the extension';
    });

    const key = editor.inventory?.roots[0];
    if (key) project.edit((spec) => void spec.effects.push(newEffect('spin', [key], 'smoke')));
    await until(() => (playback.ir?.tracks.length ?? 0) > 0, 'the IR');
    const options = () => ({ svg: editor.result!.svg, ir: playback.ir!, size: { width: 320, height: 320 }, fps: 30, background: '#ffffff' });
    await check('mp4', async () => {
      const { canExportMp4, exportMp4 } = await import('../src/core/export/video');
      if (!(await canExportMp4({ width: 320, height: 320 }))) throw new Error('canExportMp4 says no');
      const blob = await exportMp4(options());
      if (!(await host.save(blob, 'smoke.mp4'))) throw new Error('not saved');
      return `${blob.size} bytes`;
    });
    await check('gif', async () => {
      const { exportGif } = await import('../src/core/export/gif');
      const blob = await exportGif(options());
      if (!(await host.save(blob, 'smoke.gif'))) throw new Error('not saved');
      return `${blob.size} bytes`;
    });
    results.engine = { ok: true, detail: navigator.userAgent };
    // Autosave waits half a second after the last edit. Let it land before the extension reopens the file.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  vscode.postMessage({ type: 'results', results });
}

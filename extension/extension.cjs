// @ts-check
// A custom editor for .svg files that hosts the editor island in a webview. See docs/ARCHITECTURE.md section 9.
/* eslint-disable @typescript-eslint/no-require-imports */
const vscode = require('vscode');
const { createHash } = require('node:crypto');

const VIEW_TYPE = 'animatedSvgGo.editor';

/** @param {vscode.ExtensionContext} context */
exports.activate = (context) => {
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const smoke = process.env.ASG_SMOKE ? smokeRun(vscode.Uri.file(process.env.ASG_SMOKE)) : undefined;

  /** @type {vscode.CustomReadonlyEditorProvider} */
  const provider = {
    openCustomDocument: (uri) => ({ uri, dispose() {} }),
    async resolveCustomEditor({ uri }, panel) {
      const { webview } = panel;
      webview.options = { enableScripts: true, localResourceRoots: [media] };
      webview.html = page(webview, media);
      const name = uri.path.split('/').pop();
      // Global, not per workspace, so a file opened on its own keeps its effects too. URIs are absolute.
      const key = `spec:${uri.toString()}`;
      // Only the copied test file. A stray ASG_SMOKE in a shell profile must never touch a real file.
      const test = smoke && uri.toString() === smoke.file.toString() ? smoke : undefined;
      let sha256 = '';

      // The webview runs our code, but messages are still checked for shape before anything is written.
      webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'ready' && typeof message.maxBytes === 'number') {
          // The editor's own size cap, checked before reading, as the site does with a dropped file.
          if ((await vscode.workspace.fs.stat(uri)).size > message.maxBytes) return webview.postMessage({ type: 'open', name, tooLarge: true });
          const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          sha256 = createHash('sha256').update(text).digest('hex');
          // Keys are stamped by structure, so effects come back only for the exact file they were made on.
          const stored = context.globalState.get(key);
          const spec = stored?.sha256 === sha256 ? stored.spec : undefined;
          webview.postMessage({ type: 'open', name, text, spec, smoke: test?.phase });
        } else if (message?.type === 'store' && sha256 && isSmallObject(message.spec)) {
          await context.globalState.update(key, { sha256, spec: message.spec });
        } else if (message?.type === 'save' && typeof message.name === 'string' && message.bytes instanceof Uint8Array) {
          let ok = false;
          try {
            const file = message.name.replace(/[\\/]/g, '_');
            const target = test ? vscode.Uri.joinPath(test.out, file) : await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(uri, '..', file) });
            if (target) await vscode.workspace.fs.writeFile(target, message.bytes);
            ok = Boolean(target);
          } catch (error) {
            vscode.window.showErrorMessage(`Couldn't save the export: ${error instanceof Error ? error.message : error}`);
          } finally {
            // Always answered, or the export would wait for ever.
            webview.postMessage({ type: 'saved', id: message.id, ok });
          }
        } else if (message?.type === 'results' && test) {
          await test.next(message.results, uri, panel, open);
        }
      });
    },
  };

  const open = (/** @type {vscode.Uri | undefined} */ uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (target) vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('animatedSvgGo.open', open),
  );
  if (smoke) open(smoke.file);
};

// A spec is a few KB. Anything far bigger isn't one, and globalState keeps it for ever.
const MAX_SPEC_CHARS = 256 * 1024;
const isSmallObject = (/** @type {unknown} */ value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && JSON.stringify(value).length < MAX_SPEC_CHARS;

// Where VS Code serves local resources. Narrower than webview.cspSource, which is all of *.vscode-cdn.net,
// a real CDN: the site makes no network requests, so neither does the webview. CSP hosts can't hold the
// "+" in "file+.vscode-resource", so the wildcard is needed.
const RESOURCES = 'https://*.vscode-resource.vscode-cdn.net';

/**
 * The site's policy, with VS Code's resource host in place of 'self'. No frame-src on purpose:
 * it falls back to default-src, which stops the sandbox iframe navigating (ARCHITECTURE section 2).
 * @param {vscode.Webview} webview
 * @param {vscode.Uri} media
 */
function page(webview, media) {
  const src = (/** @type {string} */ file) => webview.asWebviewUri(vscode.Uri.joinPath(media, file));
  const csp = [
    "default-src 'none'",
    `script-src ${RESOURCES}`,
    `style-src ${RESOURCES}`,
    "style-src-attr 'unsafe-inline'",
    `img-src ${RESOURCES} data: blob:`,
    `font-src ${RESOURCES} data:`,
    `connect-src ${RESOURCES}`,
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${src('webview.css')}" />
    <script type="module" src="${src('webview.js')}"></script>
  </head>
  <body></body>
</html>`;
}

/**
 * pnpm ext:smoke only. Opens extension/smoke-out/drawing.svg three times: fresh (the checks), again (the effect
 * must come back), and after a change to the file (it must not). Then writes results.json for smoke.mjs.
 * @param {vscode.Uri} out
 */
function smokeRun(out) {
  const phases = ['checks', 'restored', 'changed'];
  const report = {};
  const run = {
    out,
    file: vscode.Uri.joinPath(out, 'drawing.svg'),
    /** @type {string | undefined} */
    phase: phases[0],
    /**
     * @param {Record<string, unknown>} results
     * @param {vscode.Uri} uri
     * @param {vscode.WebviewPanel} panel
     * @param {(uri: vscode.Uri) => void} open
     */
    async next(results, uri, panel, open) {
      Object.assign(report, results);
      panel.dispose();
      run.phase = phases[phases.indexOf(run.phase ?? '') + 1];
      if (run.phase === 'changed') {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${text}\n<!-- changed -->\n`));
      }
      if (run.phase) open(uri);
      else await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(out, 'results.json'), new TextEncoder().encode(JSON.stringify(report, null, 2)));
    },
  };
  return run;
}

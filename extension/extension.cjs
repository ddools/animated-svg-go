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
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      const sha256 = createHash('sha256').update(text).digest('hex');
      // Global, not per workspace, so a file opened on its own keeps its effects too. URIs are absolute.
      const key = `spec:${uri.toString()}`;

      // The webview runs our code, but messages are still checked for shape before anything is written.
      webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'ready') {
          // Keys are stamped by structure, so effects come back only for the exact file they were made on.
          const stored = context.globalState.get(key);
          const spec = stored?.sha256 === sha256 ? stored.spec : undefined;
          webview.postMessage({ type: 'open', name: uri.path.split('/').pop(), text, spec, smoke: smoke?.phase });
        } else if (message?.type === 'store') {
          await context.globalState.update(key, { sha256, spec: message.spec });
        } else if (message?.type === 'save' && typeof message.name === 'string' && message.bytes instanceof Uint8Array) {
          const name = message.name.replace(/[\\/]/g, '_');
          const target = smoke ? vscode.Uri.joinPath(smoke.out, name) : await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(uri, '..', name) });
          if (target) await vscode.workspace.fs.writeFile(target, message.bytes);
          webview.postMessage({ type: 'saved', id: message.id, ok: Boolean(target) });
        } else if (message?.type === 'results' && smoke) {
          await smoke.next(message.results, uri, panel, open);
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

/**
 * The site's policy, with the webview's resource origin in place of 'self'. No frame-src on purpose:
 * it falls back to default-src, which stops the sandbox iframe navigating (ARCHITECTURE section 2).
 * @param {vscode.Webview} webview
 * @param {vscode.Uri} media
 */
function page(webview, media) {
  const src = (/** @type {string} */ file) => webview.asWebviewUri(vscode.Uri.joinPath(media, file));
  const csp = [
    "default-src 'none'",
    `script-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    "style-src-attr 'unsafe-inline'",
    `img-src ${webview.cspSource} data: blob:`,
    `font-src ${webview.cspSource} data:`,
    `connect-src ${webview.cspSource}`,
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

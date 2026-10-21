// Spike: a custom editor for .svg files that hosts the editor island in a webview.
/* eslint-disable @typescript-eslint/no-require-imports */
const vscode = require('vscode');

exports.activate = (context) => {
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const out = vscode.Uri.joinPath(context.extensionUri, 'spike-out');

  const provider = {
    resolveCustomTextEditor(document, panel) {
      const { webview } = panel;
      webview.options = { enableScripts: true, localResourceRoots: [media] };
      const src = (file) => webview.asWebviewUri(vscode.Uri.joinPath(media, file));
      // The site's policy, with the webview's resource origin in place of 'self'.
      const csp = [
        "default-src 'none'",
        `script-src ${webview.cspSource}`,
        `style-src ${webview.cspSource}`,
        "style-src-attr 'unsafe-inline'",
        `img-src ${webview.cspSource} data: blob:`,
        `font-src ${webview.cspSource} data:`,
        `connect-src ${webview.cspSource} blob:`,
        'worker-src blob:',
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      webview.html = `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${src('webview.css')}" />
    <script type="module" src="${src('webview.js')}"></script>
  </head>
  <body></body>
</html>`;

      webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'ready') {
          const name = document.uri.path.split('/').pop();
          webview.postMessage({ type: 'open', name, text: document.getText() });
        } else if (message.type === 'save') {
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(document.uri, '..', message.name) });
          if (target) await vscode.workspace.fs.writeFile(target, message.bytes);
        } else if (message.type === 'results') {
          for (const file of message.files) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(out, file.name), file.bytes);
          const json = JSON.stringify(message.results, null, 2);
          await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(out, 'results.json'), new TextEncoder().encode(json));
          const failed = Object.entries(message.results).filter(([, check]) => !check.ok).map(([name]) => name);
          vscode.window.showInformationMessage(failed.length ? `Spike failed: ${failed.join(', ')}` : 'Spike: every check passed.');
        }
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('animatedSvgGo.editor', provider, { webviewOptions: { retainContextWhenHidden: true } }),
  );

  // Unattended runs name a file to open, so the checks run without anyone clicking.
  if (process.env.SPIKE_FILE) vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(process.env.SPIKE_FILE), 'animatedSvgGo.editor');
};

// pnpm ext:smoke: runs the webview checks in a local VS Code and fails if any of them fails. Mac, local only.
// Build first (pnpm ext:build). See docs/ARCHITECTURE.md section 9.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
// Short on purpose: VS Code's socket path inside the profile must stay under 103 characters.
const profile = `${dir}.u`;
const out = `${dir}smoke-out`;
const binary = process.env.VSCODE_BIN ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

// The run changes the file to test the restore rule, so it works on a copy.
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
copyFileSync(fileURLToPath(new URL('../tests/corpus/files/twbs/0-circle-fill.svg', import.meta.url)), `${out}/drawing.svg`);

// Run from VS Code's own terminal, these hand the launch to the open window instead of starting a new one.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VSCODE_|ELECTRON_)/.test(key)));
const args = [
  `--user-data-dir=${profile}/d`,
  `--extensions-dir=${profile}/e`,
  `--extensionDevelopmentPath=${dir}`,
  // A fresh profile asks about workspace trust, and the extension never activates while it waits.
  '--disable-workspace-trust',
  '--disable-extensions',
  '--skip-welcome',
  '--new-window',
  // Opens as XML text, which activates the extension. It then reopens the file in its own editor.
  `${out}/drawing.svg`,
];
spawn(binary, args, { env: { ...env, ASG_SMOKE: out }, stdio: 'ignore', detached: true }).unref();

let report = null;
for (let waited = 0; waited < 120_000 && !report; waited += 500) {
  await wait(500);
  if (existsSync(`${out}/results.json`)) report = JSON.parse(readFileSync(`${out}/results.json`, 'utf8'));
}

// Every helper process too. A survivor holds the profile, and the next run is handed to it.
for (let tries = 0; spawnSync('pgrep', ['-f', profile]).status === 0 && tries < 20; tries++) {
  spawnSync('pkill', ['-9', '-f', profile]);
  await wait(250);
}
rmSync(profile, { recursive: true, force: true });

if (!report) {
  console.error('No results from the webview within two minutes.');
  process.exit(1);
}
const checks = Object.entries(report);
for (const [name, check] of checks) console.log(`${check.ok ? 'pass' : 'FAIL'}  ${name}: ${check.detail}`);
process.exit(checks.some(([, check]) => !check.ok) ? 1 : 0);

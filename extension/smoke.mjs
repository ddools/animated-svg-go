// pnpm ext:smoke: runs the webview checks in a local VS Code and fails if any of them fails. Mac, local only.
// Build first (pnpm ext:build). With --vsix <file>, it installs that package and checks it instead of this folder.
// See docs/ARCHITECTURE.md section 9.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
// Short on purpose: VS Code's socket path inside the profile must stay under 103 characters.
const profile = `${dir}.u`;
const out = `${dir}smoke-out`;
const app = process.env.VSCODE_APP ?? '/Applications/Visual Studio Code.app';
const vsix = process.argv.includes('--vsix') ? process.argv[process.argv.indexOf('--vsix') + 1] : undefined;

// The run changes the file to test the restore rule, so it works on a copy.
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
copyFileSync(fileURLToPath(new URL('../tests/corpus/files/twbs/0-circle-fill.svg', import.meta.url)), `${out}/drawing.svg`);

// Run from VS Code's own terminal, these hand the launch to the open window instead of starting a new one.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VSCODE_|ELECTRON_)/.test(key)));
const profileArgs = [`--user-data-dir=${profile}/d`, `--extensions-dir=${profile}/e`];
if (vsix) execFileSync(`${app}/Contents/Resources/app/bin/code`, [...profileArgs, '--install-extension', vsix], { env, stdio: 'inherit' });
const args = [
  ...profileArgs,
  // The package is the profile's only extension, so only the folder under test needs the others turned off.
  ...(vsix ? [] : [`--extensionDevelopmentPath=${dir}`, '--disable-extensions']),
  // A fresh profile asks about workspace trust, and the extension never activates while it waits.
  '--disable-workspace-trust',
  '--skip-welcome',
  '--new-window',
  // Opens as XML text, which activates the extension. It then reopens the file in its own editor.
  `${out}/drawing.svg`,
];
spawn(`${app}/Contents/MacOS/Code`, args, { env: { ...env, ASG_SMOKE: out }, stdio: 'ignore', detached: true }).unref();

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

// Builds the editor island into media/ for the webview. Spike only.
// Vite and the Svelte plugin are borrowed from Astro's install, so the spike adds no dependencies.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);
const from = (pkg, dep) => pathToFileURL(createRequire(require.resolve(`${pkg}/package.json`)).resolve(dep)).href;
const { build } = await import(from('astro', 'vite'));
const { svelte } = await import(from('@astrojs/svelte', '@sveltejs/vite-plugin-svelte'));

await build({
  configFile: false,
  // The repo root, so Tailwind finds the classes in src/editor.
  root: fileURLToPath(new URL('..', import.meta.url)),
  // Relative, so chunks and the worker resolve against the webview resource URL.
  base: './',
  publicDir: false,
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: 'extension/media',
    emptyOutDir: true,
    rollupOptions: {
      input: 'extension/webview.ts',
      output: { entryFileNames: 'webview.js', assetFileNames: '[name][extname]' },
    },
  },
});

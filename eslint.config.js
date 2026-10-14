import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default defineConfig(
  { ignores: ['dist/', '.astro/', '.vercel/', 'playwright-report/', 'test-results/', '.claude/'] },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  // TypeScript checks undefined names, and knows the browser globals.
  // Large sets live in $state.raw and are replaced, never mutated, so SvelteSet would only add cost.
  { rules: { 'no-undef': 'off', 'svelte/prefer-svelte-reactivity': 'off' } },
  { files: ['**/*.svelte', '**/*.svelte.ts'], languageOptions: { parserOptions: { parser: ts.parser } } },
  // Zod must be configured before any schema is built. See src/core/spec/zod.ts.
  {
    ignores: ['src/core/spec/zod.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: 'zod', message: 'Import z from src/core/spec/zod.ts.', allowTypeImports: true }] }] },
  },
);

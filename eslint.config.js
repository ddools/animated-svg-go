import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default defineConfig(
  { ignores: ['dist/', '.astro/', '.vercel/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  // TypeScript checks undefined names, and knows the browser globals.
  { rules: { 'no-undef': 'off' } },
  { files: ['**/*.svelte', '**/*.svelte.ts'], languageOptions: { parserOptions: { parser: ts.parser } } },
);

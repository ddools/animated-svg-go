import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  integrations: [svelte()],
  vite: { plugins: [tailwindcss()] },
  security: {
    // Astro adds script-src and style-src ('self' plus hashes) itself.
    csp: {
      // Uploaded SVGs carry style attributes. Chromium reports a violation as soon as one is
      // parsed, even in an inert document, so the attribute form (only) is allowed.
      // <style> elements and stylesheets still need 'self' or a hash.
      styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
      directives: [
        // No frame-src on purpose: it falls back to this, which is what stops the sandbox
        // iframe, or anything inside it, from navigating to a real page.
        "default-src 'none'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "base-uri 'none'",
        "form-action 'none'",
      ],
    },
  },
});

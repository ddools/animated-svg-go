/// <reference types="astro/client" />

interface Window {
  __asg?: { normalise: typeof import('./editor/pipeline').normaliseFile };
}

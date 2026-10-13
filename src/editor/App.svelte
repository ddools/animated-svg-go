<script lang="ts">
  import { normaliseFile } from './pipeline';

  // Test hook. Only present in builds made with PUBLIC_E2E set, never in production.
  if (import.meta.env.PUBLIC_E2E) window.__asg = { normalise: normaliseFile };
</script>

<main class="p-4">
  <h1 class="text-2xl font-bold">Editor</h1>
</main>

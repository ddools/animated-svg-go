<script lang="ts">
  import IconSearch from './IconSearch.svelte';
  import { loadFile, loadText } from './load';
  import { savedProject } from './project.svelte';
  import { editor } from './state.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void loadFile(file);
    input.value = '';
  }
</script>

{#if compact}
  <label class="btn btn-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2">
    Open another file
    <!-- sr-only, not hidden: a hidden input takes no focus, so the keyboard could never open a file. -->
    <input type="file" accept=".svg,image/svg+xml" class="sr-only" onchange={pick} />
  </label>
{:else}
  <div class="grid h-full place-items-center overflow-y-auto p-6">
    <label class="border-base-300 hover:border-primary has-focus-visible:border-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 flex w-full max-w-xl cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-12 text-center">
      <span class="text-2xl font-bold">Drop an SVG here</span>
      <span>Or click to choose one. You can paste too.</span>
      <span class="text-sm opacity-70">Your file never leaves your browser.</span>
      <input type="file" accept=".svg,image/svg+xml" class="sr-only" onchange={pick} />
    </label>
    <!-- Offered, never automatic: a file that hangs the tab must not reload itself forever. -->
    {#await savedProject() then project}
      {#if project}
        <button type="button" class="btn mt-4" onclick={() => loadText(project.text, project.fileName, project.spec ?? undefined)}>
          Pick up where you left off: {project.fileName}
        </button>
      {/if}
    {/await}
    {#if editor.status === 'error'}
      <p role="alert" class="alert alert-error mt-4 max-w-xl">{editor.error}</p>
    {/if}
    <IconSearch />
  </div>
{/if}

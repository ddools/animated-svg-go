<script lang="ts">
  import { planRuns } from '../core/ir/compile';
  import { EFFECTS, type Effect } from '../core/spec/schema';
  import { project } from './project.svelte';
  import { selection } from './selection.svelte';

  const duration = $derived(project.spec.duration);

  /** Seconds from the first run's start to the last run's end, with the stagger's tail. Null if it never plays. */
  function span(effect: Effect) {
    const { runs } = planRuns(effect.timing, duration);
    if (!runs.length) return null;
    const tail = effect.stagger ? (effect.targets.length - 1) * effect.stagger.gap : 0;
    return { from: runs[0].start, to: Math.min(duration, runs[runs.length - 1].end + tail) };
  }

  function choose(effect: Effect) {
    project.active = effect.id;
    selection.set(effect.targets);
  }
</script>

<!-- A fixed height, there before the first effect, so the drawing doesn't jump when one is added. -->
<ul class="border-base-300 flex h-28 shrink-0 flex-col gap-1 overflow-y-auto border-t px-4 py-2 text-xs" aria-label="Effect bars">
  {#if !project.spec.effects.length}
    <li class="opacity-60">Each effect shows here as a bar on the timeline.</li>
  {/if}
  {#each project.spec.effects as effect (effect.id)}
    {@const range = span(effect)}
    <li class="bg-base-200 relative h-5 shrink-0 rounded">
      {#if range}
        <button
          type="button"
          class="btn btn-primary btn-xs absolute inset-y-0 min-h-0 justify-start overflow-hidden px-1"
          class:btn-outline={effect.id !== project.active}
          style:left={`${(range.from / duration) * 100}%`}
          style:width={`${((range.to - range.from) / duration) * 100}%`}
          aria-pressed={effect.id === project.active}
          aria-label={`${EFFECTS[effect.type].label}, ${range.from.toFixed(2)} to ${range.to.toFixed(2)} seconds`}
          onclick={() => choose(effect)}
        >
          {EFFECTS[effect.type].label}
        </button>
      {/if}
    </li>
  {/each}
</ul>

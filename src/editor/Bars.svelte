<script lang="ts">
  import { planRuns } from '../core/ir/compile';
  import { EFFECTS, type Effect } from '../core/spec/schema';
  import { project } from './project.svelte';
  import { chooseEffect } from './selection.svelte';

  const duration = $derived(project.spec.duration);

  /** Seconds from the first run's start to the last run's end, with the stagger's tail. Null if it never plays. */
  function span(effect: Effect) {
    const { runs } = planRuns(effect.timing, duration);
    if (!runs.length) return null;
    const tail = effect.stagger ? (effect.targets.length - 1) * effect.stagger.gap : 0;
    return { from: runs[0].start, to: Math.min(duration, runs[runs.length - 1].end + tail) };
  }

  /** Where the bar was picked up. Null until it has moved a few pixels, so a click stays a click. */
  let grab: { x: number; start: number; moved: boolean } | null = null;

  /** Sets a start or run length, snapped to the panel slider's step. A drag is one undo step. */
  function retime(id: string, field: 'start' | 'duration', seconds: number, mode: 'edit' | 'drag') {
    project[mode]((spec) => {
      const effect = spec.effects.find((e) => e.id === id);
      if (!effect) return;
      const min = field === 'start' ? 0 : (EFFECTS[effect.type].minDuration ?? 0.05);
      effect.timing[field] = Math.min(duration, Math.max(min, Math.round(seconds * 20) / 20));
    });
  }

  /** Drags the whole bar: moves its start by however far the pointer has gone. */
  function move(event: PointerEvent, effect: Effect) {
    const bar = event.currentTarget as HTMLElement;
    if (!grab || !bar.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - grab.x;
    if (!grab.moved && Math.abs(dx) < 3) return;
    grab.moved = true;
    const track = bar.parentElement!.getBoundingClientRect();
    retime(effect.id, 'start', grab.start + (dx / track.width) * duration, 'drag');
  }

  /** Drags the bar's end: works back from where it lands to one run's length. */
  function resize(event: PointerEvent, effect: Effect) {
    const handle = event.currentTarget as HTMLElement;
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const track = handle.parentElement!.getBoundingClientRect();
    const end = ((event.clientX - track.left) / track.width) * duration;
    const { start, iterations } = effect.timing;
    const tail = effect.stagger ? (effect.targets.length - 1) * effect.stagger.gap : 0;
    retime(effect.id, 'duration', (end - start - tail) / (iterations === 'infinite' ? 1 : iterations), 'drag');
  }

  function nudge(event: KeyboardEvent, effect: Effect) {
    const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[event.key];
    if (!step) return;
    event.preventDefault();
    retime(effect.id, 'duration', effect.timing.duration + step * (event.shiftKey ? 10 : 1), 'edit');
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
          class="btn btn-primary btn-xs absolute inset-y-0 min-h-0 cursor-grab touch-none justify-start overflow-hidden px-1 active:cursor-grabbing"
          class:btn-outline={effect.id !== project.active}
          style:left={`${(range.from / duration) * 100}%`}
          style:width={`${((range.to - range.from) / duration) * 100}%`}
          aria-pressed={effect.id === project.active}
          aria-label={`${EFFECTS[effect.type].label}, ${range.from.toFixed(2)} to ${range.to.toFixed(2)} seconds`}
          onclick={() => chooseEffect(effect)}
          onpointerdown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            grab = { x: event.clientX, start: effect.timing.start, moved: false };
          }}
          onpointermove={(event) => move(event, effect)}
          onlostpointercapture={() => {
            grab = null;
            project.settle();
          }}
        >
          {EFFECTS[effect.type].label}
        </button>
        <div
          role="slider"
          tabindex="0"
          class="bg-base-content/40 hover:bg-base-content/70 focus-visible:outline-primary absolute inset-y-0 w-1.5 -translate-x-full cursor-ew-resize touch-none rounded-r"
          style:left={`${(range.to / duration) * 100}%`}
          aria-label={`${EFFECTS[effect.type].label} duration`}
          aria-valuemin={EFFECTS[effect.type].minDuration ?? 0.05}
          aria-valuemax={duration}
          aria-valuenow={effect.timing.duration}
          aria-valuetext={`${effect.timing.duration} seconds per run`}
          onpointerdown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            chooseEffect(effect);
          }}
          onpointermove={(event) => resize(event, effect)}
          onlostpointercapture={() => project.settle()}
          onkeydown={(event) => nudge(event, effect)}
        ></div>
      {/if}
    </li>
  {/each}
</ul>

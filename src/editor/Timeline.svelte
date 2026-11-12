<script lang="ts">
  import { playback } from './playback.svelte';
  import { project } from './project.svelte';

  const duration = $derived(project.spec.duration);
  const time = $derived(Math.min(playback.time, duration));

  function setDuration(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (value >= 0.1 && value <= 60) project.edit((spec) => void (spec.duration = value));
  }
</script>

<div class="border-base-300 flex items-center gap-3 border-t px-4 py-2 text-sm" role="group" aria-label="Playback">
  <button
    type="button"
    class="btn btn-sm btn-primary w-20"
    onclick={() => (playback.playing ? playback.pause() : playback.play())}
    data-testid="play"
  >
    {playback.playing ? 'Pause' : 'Play'}
  </button>
  <input
    type="range"
    class="range range-xs flex-1"
    min="0"
    max={duration}
    step="0.01"
    value={time}
    aria-label="Playhead"
    aria-valuetext={`${time.toFixed(2)} seconds`}
    oninput={(event) => playback.seek(Number(event.currentTarget.value))}
  />
  <output class="w-24 text-right tabular-nums" data-testid="time">{time.toFixed(2)} s / {duration} s</output>
  <label class="flex items-center gap-1">
    Length
    <input type="number" class="input input-xs w-16" min="0.1" max="60" step="0.1" value={duration} onchange={setDuration} />
    s
  </label>
  <label class="flex items-center gap-1">
    <input
      type="checkbox"
      class="checkbox checkbox-xs"
      checked={project.spec.loop}
      onchange={(event) => {
        const loop = event.currentTarget.checked;
        project.edit((spec) => void (spec.loop = loop));
      }}
    />
    Loop
  </label>
</div>

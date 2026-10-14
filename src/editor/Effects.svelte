<script lang="ts">
  import type { NoteCode } from '../core/ir/types';
  import { EFFECTS, newEffect, type Effect, type EffectType } from '../core/spec/schema';
  import EasingPicker from './EasingPicker.svelte';
  import { playback } from './playback.svelte';
  import { project } from './project.svelte';
  import { selection } from './selection.svelte';

  const has = (n: number) => (n === 1 ? '1 shape has' : `${n} shapes have`);
  const NOTES: Record<NoteCode, (n: number) => string> = {
    missing: (n) => (n === 1 ? '1 shape is' : `${n} shapes are`) + ' no longer in the file.',
    unwrapped: (n) => `${shapes(n)} can't be moved without changing the file. Try the group around them.`,
    'no-length': (n) => `${has(n)} no outline to draw along.`,
    'no-stroke': (n) => `${has(n)} no stroke, so there is nothing to draw.`,
    dashed: (n) => `Dashes already on ${shapes(n)} are replaced while drawing.`,
    overlap: (n) => `A later effect animates ${shapes(n)} at the same time. The later one plays.`,
    squeezed: () => "Runs past the end of the timeline, so it's been shortened.",
    outside: () => 'Starts after the timeline ends, so it never plays.',
    'too-big': (n) => `Too much animation to fit in one file, so ${shapes(n)} won't move. Try fewer shapes or longer runs.`,
  };

  const ORDERS = [
    ['start', 'Top of the file first'],
    ['end', 'Bottom first'],
    ['centre', 'From the centre'],
    ['random', 'Random'],
    ['x', 'Left to right'],
    ['y', 'Top to bottom'],
  ] as const;

  const TYPES =Object.keys(EFFECTS) as EffectType[];
  const active = $derived(project.spec.effects.find((effect) => effect.id === project.active));
  const module = $derived(active && EFFECTS[active.type]);

  function shapes(count: number) {
    return count === 1 ? '1 shape' : `${count} shapes`;
  }

  function notesFor(id: string) {
    return (playback.ir?.notes ?? []).filter((note) => note.effect === id).map((note) => NOTES[note.code](note.targets.length));
  }

  function add(type: EffectType) {
    const id = `e${crypto.randomUUID().slice(0, 8)}`;
    const wasPlaying = playback.playing;
    project.edit((spec) => void spec.effects.push(newEffect(type, [...selection.keys], id)));
    project.active = id;
    // Show the new effect moving, unless the person has asked their system for less motion.
    if (!wasPlaying && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      playback.refresh();
      playback.play();
    }
  }

  function remove(id: string) {
    project.edit((spec) => void (spec.effects = spec.effects.filter((effect) => effect.id !== id)));
    if (project.active === id) project.active = null;
  }

  function choose(effect: Effect) {
    project.active = effect.id;
    selection.set(effect.targets);
  }

  /** Changes the active effect. A drag is one undo step, settled on the change event. */
  function drag(change: (effect: Effect) => void) {
    const id = project.active;
    project.drag((spec) => change(spec.effects.find((effect) => effect.id === id)!));
  }
  function edit(change: (effect: Effect) => void) {
    const id = project.active;
    project.edit((spec) => change(spec.effects.find((effect) => effect.id === id)!));
  }

  const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

  /** A new random seed wherever the active effect has one. One undo step. */
  function shuffle() {
    edit((effect) => {
      if (effect.stagger) effect.stagger.seed = randomSeed();
      const params = effect.params as { seed?: unknown };
      if (typeof params.seed === 'number') params.seed = randomSeed();
    });
  }

  const number =(event: Event) => Number((event.currentTarget as HTMLInputElement).value);
</script>

<section aria-labelledby="effects-heading" class="flex flex-col gap-2">
  <h2 id="effects-heading" class="font-bold">Effects</h2>
  <div class="flex flex-wrap gap-1" role="group" aria-label="Add an effect to the selection">
    {#each TYPES as type (type)}
      <button type="button" class="btn btn-xs btn-primary btn-outline" disabled={!selection.keys.size} onclick={() => add(type)}>
        + {EFFECTS[type].label}
      </button>
    {/each}
  </div>

  {#if project.spec.effects.length}
    <ul class="flex flex-col gap-1" aria-label="Effects in this animation">
      {#each project.spec.effects as effect (effect.id)}
        {@const notes = notesFor(effect.id)}
        <li class="flex flex-col gap-1">
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="btn btn-sm flex-1 justify-start"
              class:btn-active={effect.id === project.active}
              aria-pressed={effect.id === project.active}
              onclick={() => choose(effect)}
            >
              {EFFECTS[effect.type].label}
              <span class="opacity-60">{shapes(effect.targets.length)}</span>
            </button>
            <button type="button" class="btn btn-sm btn-ghost" aria-label={`Remove ${EFFECTS[effect.type].label}`} onclick={() => remove(effect.id)}>×</button>
          </div>
          {#each notes as note (note)}
            <p class="alert alert-warning alert-soft px-3 py-1 text-xs" data-testid="effect-note">{note}</p>
          {/each}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="opacity-70">Select some shapes, then add an effect.</p>
  {/if}

  {#if active && module}
    <div class="flex flex-col gap-2" role="group" aria-label={`${module.label} settings`}>
      {#each module.ui as control (control.key)}
        {@const params = active.params as Record<string, number | string>}
        {#if control.kind === 'range'}
          <label class="flex flex-col gap-1">
            <span class="flex justify-between">{control.label} <span>{params[control.key]}{control.unit}</span></span>
            <input
              type="range"
              class="range range-xs"
              min={control.min}
              max={control.max}
              step={control.step}
              value={params[control.key]}
              oninput={(event) => {
                const next = number(event);
                drag((effect) => void ((effect.params as Record<string, unknown>)[control.key] = next));
              }}
              onchange={() => project.settle()}
            />
          </label>
        {:else if control.kind === 'select'}
          <label class="flex items-center justify-between gap-2">
            {control.label}
            <select
              class="select select-xs w-40"
              value={params[control.key]}
              onchange={(event) => {
                const next = event.currentTarget.value;
                edit((effect) => void ((effect.params as Record<string, unknown>)[control.key] = next));
              }}
            >
              {#each control.options as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        {:else}
          <label class="flex items-center justify-between gap-2">
            {control.label}
            <input
              type="color"
              class="h-6 w-12 cursor-pointer"
              value={params[control.key]}
              oninput={(event) => {
                const next = event.currentTarget.value;
                drag((effect) => void ((effect.params as Record<string, unknown>)[control.key] = next));
              }}
              onchange={() => project.settle()}
            />
          </label>
        {/if}
      {/each}

      {#if module.pivot}
        {@const pivot = active.pivot ?? { fx: 0.5, fy: 0.5 }}
        {#each [['fx', 'Pivot across'], ['fy', 'Pivot down']] as const as [axis, label] (axis)}
          <label class="flex flex-col gap-1">
            <span class="flex justify-between">{label} <span>{Math.round(pivot[axis] * 100)}%</span></span>
            <input
              type="range"
              class="range range-xs"
              min="0"
              max="100"
              step="1"
              value={pivot[axis] * 100}
              oninput={(event) => {
                const next = number(event) / 100;
                drag((effect) => void (effect.pivot = { ...(effect.pivot ?? { fx: 0.5, fy: 0.5 }), [axis]: next }));
              }}
              onchange={() => project.settle()}
            />
          </label>
        {/each}
      {/if}

      <label class="flex flex-col gap-1">
        <span class="flex justify-between">Start <span>{active.timing.start} s</span></span>
        <input
          type="range"
          class="range range-xs"
          min="0"
          max={project.spec.duration}
          step="0.05"
          value={active.timing.start}
          oninput={(event) => {
            const next = number(event);
            drag((effect) => void (effect.timing.start = next));
          }}
          onchange={() => project.settle()}
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="flex justify-between">Duration <span>{active.timing.duration} s</span></span>
        <input
          type="range"
          class="range range-xs"
          min={module.minDuration ?? 0.05}
          max={project.spec.duration}
          step="0.05"
          value={active.timing.duration}
          oninput={(event) => {
            const next = number(event);
            drag((effect) => void (effect.timing.duration = next));
          }}
          onchange={() => project.settle()}
        />
      </label>
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-1">
          Runs
          <input
            type="number"
            class="input input-xs w-16"
            min="1"
            max="100"
            step="1"
            disabled={active.timing.iterations === 'infinite'}
            value={active.timing.iterations === 'infinite' ? '' : active.timing.iterations}
            onchange={(event) => {
              const next = Math.round(number(event));
              if (next >= 1 && next <= 100) edit((effect) => void (effect.timing.iterations = next));
            }}
          />
        </label>
        <label class="flex items-center gap-1">
          <input
            type="checkbox"
            class="checkbox checkbox-xs"
            checked={active.timing.iterations === 'infinite'}
            onchange={(event) => {
              const forever = event.currentTarget.checked;
              edit((effect) => void (effect.timing.iterations = forever ? 'infinite' : 1));
            }}
          />
          Until the end
        </label>
      </div>
      <label class="flex items-center justify-between gap-2">
        Direction
        <select
          class="select select-xs w-40"
          value={active.timing.direction}
          onchange={(event) => {
            const next = event.currentTarget.value as Effect['timing']['direction'];
            edit((effect) => void (effect.timing.direction = next));
          }}
        >
          <option value="normal">Forwards</option>
          <option value="reverse">Backwards</option>
          <option value="alternate">Back and forth</option>
        </select>
      </label>
      <EasingPicker effect={active} />

      <label class="flex items-center gap-1">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={!!active.stagger}
          onchange={(event) => {
            const on = event.currentTarget.checked;
            edit((effect) => {
              if (on) effect.stagger = { gap: 0.1, order: 'start', seed: randomSeed() };
              else delete effect.stagger;
            });
          }}
        />
        Stagger
      </label>
      {#if active.stagger}
        <label class="flex flex-col gap-1">
          <span class="flex justify-between">Gap <span>{active.stagger.gap} s</span></span>
          <input
            type="range"
            class="range range-xs"
            min="0"
            max="2"
            step="0.05"
            value={active.stagger.gap}
            oninput={(event) => {
              const next = number(event);
              drag((effect) => void (effect.stagger && (effect.stagger.gap = next)));
            }}
            onchange={() => project.settle()}
          />
        </label>
        <label class="flex items-center justify-between gap-2">
          Order
          <select
            class="select select-xs w-40"
            value={active.stagger.order}
            onchange={(event) => {
              const next = event.currentTarget.value as NonNullable<Effect['stagger']>['order'];
              edit((effect) => void (effect.stagger && (effect.stagger.order = next)));
            }}
          >
            {#each ORDERS as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
      {/if}
      {#if active.stagger || typeof (active.params as { seed?: unknown }).seed === 'number'}
        <button type="button" class="btn btn-xs btn-outline self-start" onclick={shuffle}>Shuffle</button>
      {/if}
    </div>
  {/if}
</section>

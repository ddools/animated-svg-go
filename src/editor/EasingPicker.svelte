<script lang="ts">
  import type { Easing, Effect, Timing } from '../core/spec/schema';
  import { project } from './project.svelte';

  let { effect }: { effect: Effect } = $props();

  const PRESETS: { name: string; easing: Easing }[] = [
    { name: 'Linear', easing: { kind: 'cubic', p: [0, 0, 1, 1] } },
    { name: 'Ease', easing: { kind: 'cubic', p: [0.25, 0.1, 0.25, 1] } },
    { name: 'Ease in', easing: { kind: 'cubic', p: [0.42, 0, 1, 1] } },
    { name: 'Ease out', easing: { kind: 'cubic', p: [0, 0, 0.58, 1] } },
    { name: 'Ease in and out', easing: { kind: 'cubic', p: [0.42, 0, 0.58, 1] } },
    { name: 'Gentle spring', easing: { kind: 'spring', bounce: 0.2 } },
    { name: 'Bouncy spring', easing: { kind: 'spring', bounce: 0.5 } },
    { name: 'Steps', easing: { kind: 'steps', n: 4, pos: 'end' } },
  ];

  const easing = $derived(effect.timing.easing);
  const name = $derived(PRESETS.find((preset) => JSON.stringify(preset.easing) === JSON.stringify(easing))?.name ?? 'Custom');

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value * 100) / 100));
  const range = (index: number) => (index % 2 ? ([-5, 5] as const) : ([0, 1] as const));

  /** Changes this effect's easing. A drag is one undo step, settled on release. */
  function change(apply: (timing: Timing) => void, mode: 'edit' | 'drag' = 'edit') {
    const id = effect.id;
    project[mode]((spec) => apply(spec.effects.find((e) => e.id === id)!.timing));
  }

  /** Sets one control-point coordinate. */
  function setPoint(index: number, value: number, mode: 'edit' | 'drag' = 'edit') {
    if (Number.isNaN(value)) return;
    const [min, max] = range(index);
    change(({ easing: e }) => {
      if (e.kind === 'cubic') e.p[index] = clamp(value, min, max);
    }, mode);
  }

  // The curve box maps x 0..1 to 10..110 and y -0.5..1.5 to 100..0. Handles outside it pin to its edge.
  const px = (x: number) => 10 + 100 * x;
  const py = (y: number) => 100 - (Math.min(1.5, Math.max(-0.5, y)) + 0.5) * 50;

  function move(event: PointerEvent, handle: 0 | 1) {
    if (!(event.currentTarget as Element).hasPointerCapture(event.pointerId)) return;
    const box = (event.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 120;
    const y = ((event.clientY - box.top) / box.height) * 120;
    setPoint(handle * 2, (x - 10) / 100, 'drag');
    setPoint(handle * 2 + 1, (100 - y) / 50 - 0.5, 'drag');
  }

  function key(event: KeyboardEvent, handle: 0 | 1) {
    const step = event.shiftKey ? 0.1 : 0.01;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!by || easing.kind !== 'cubic') return;
    event.preventDefault();
    if (by[0]) setPoint(handle * 2, easing.p[handle * 2] + by[0]);
    if (by[1]) setPoint(handle * 2 + 1, easing.p[handle * 2 + 1] + by[1]);
  }

  const HANDLES = [
    { handle: 0, label: 'First control point', from: [0, 0] },
    { handle: 1, label: 'Second control point', from: [1, 1] },
  ] as const;
  const AXES = ['x1', 'y1', 'x2', 'y2'];
</script>

<div class="flex flex-col gap-2" role="group" aria-label="Easing curve">
  <label class="flex items-center justify-between gap-2">
    Easing
    <select
      class="select select-xs w-40"
      value={name}
      onchange={(event) => {
        const chosen = PRESETS.find((preset) => preset.name === event.currentTarget.value);
        if (chosen) change((timing) => void (timing.easing = structuredClone(chosen.easing)));
      }}
    >
      {#each PRESETS as preset (preset.name)}
        <option>{preset.name}</option>
      {/each}
      {#if name === 'Custom'}<option disabled>Custom</option>{/if}
    </select>
  </label>

  {#if easing.kind === 'cubic'}
    {@const p = easing.p}
    <svg viewBox="0 0 120 120" class="bg-base-200 mx-auto size-30 touch-none rounded" role="group" aria-label="Curve">
      <rect x="10" y={py(1)} width="100" height="50" class="fill-none stroke-current opacity-20" />
      <path d={`M${px(0)} ${py(0)}C${px(p[0])} ${py(p[1])} ${px(p[2])} ${py(p[3])} ${px(1)} ${py(1)}`} class="fill-none stroke-current" stroke-width="2" />
      {#each HANDLES as { handle, label, from } (handle)}
        {@const x = p[handle * 2]}
        {@const y = p[handle * 2 + 1]}
        <line x1={px(from[0])} y1={py(from[1])} x2={px(x)} y2={py(y)} class="stroke-current opacity-40" />
        <circle
          cx={px(x)}
          cy={py(y)}
          r="6"
          class="fill-primary cursor-grab stroke-current focus:stroke-2"
          role="slider"
          tabindex="0"
          aria-label={label}
          aria-valuemin="0"
          aria-valuemax="1"
          aria-valuenow={x}
          aria-valuetext={`${AXES[handle * 2]} ${x}, ${AXES[handle * 2 + 1]} ${y}`}
          onpointerdown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onpointermove={(event) => move(event, handle)}
          onpointerup={() => project.settle()}
          onpointercancel={() => project.settle()}
          onkeydown={(event) => key(event, handle)}
        />
      {/each}
    </svg>
    <div class="grid grid-cols-4 gap-1">
      {#each AXES as axis, index (axis)}
        {@const [min, max] = range(index)}
        <label class="flex flex-col text-xs">
          {axis}
          <input
            type="number"
            class="input input-xs w-full"
            {min}
            {max}
            step="0.01"
            value={p[index]}
            onchange={(event) => setPoint(index, event.currentTarget.valueAsNumber)}
          />
        </label>
      {/each}
    </div>
  {:else if easing.kind === 'spring'}
    <label class="flex flex-col gap-1">
      <span class="flex justify-between">Bounce <span>{easing.bounce}</span></span>
      <input
        type="range"
        class="range range-xs"
        min="0"
        max="0.9"
        step="0.05"
        value={easing.bounce}
        oninput={(event) => {
          const next = event.currentTarget.valueAsNumber;
          change(({ easing: e }) => void (e.kind === 'spring' && (e.bounce = next)), 'drag');
        }}
        onchange={() => project.settle()}
      />
    </label>
  {:else}
    <div class="flex items-center gap-2">
      <label class="flex items-center gap-1">
        Steps
        <input
          type="number"
          class="input input-xs w-16"
          min="1"
          max="100"
          step="1"
          value={easing.n}
          onchange={(event) => {
            const next = Math.round(event.currentTarget.valueAsNumber);
            if (next >= 1 && next <= 100) change(({ easing: e }) => void (e.kind === 'steps' && (e.n = next)));
          }}
        />
      </label>
      <label class="flex items-center gap-1">
        Jump at
        <select
          class="select select-xs w-24"
          value={easing.pos}
          onchange={(event) => {
            const next = event.currentTarget.value as 'start' | 'end';
            change(({ easing: e }) => void (e.kind === 'steps' && (e.pos = next)));
          }}
        >
          <option value="start">Start</option>
          <option value="end">End</option>
        </select>
      </label>
    </div>
  {/if}
</div>

// The live preview: the IR played with element.animate() inside the sandbox. See docs/ARCHITECTURE.md section 3.
// Uses the DOM only when called, never at import.
import { ADDITIVE_PROPERTIES, WRAPPER_PROPERTIES, type IR, type Track } from '../ir/types';

export type Preview = {
  /** Brings the running animations in line with the IR, keeping time and play state. */
  apply(ir: IR): void;
  /** Seconds. */
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  /** Seconds into the timeline. */
  time(): number;
  playing(): boolean;
  destroy(): void;
};

type Target = { root: SVGSVGElement; elementFor(key: string): Element | undefined };

const camel = (property: string) => property.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

/** Transform and opacity move the wrapper. Paint and dashes go on the element (invariant 3). */
function targetOf(sandbox: Target, track: Track): Element | undefined {
  const element = sandbox.elementFor(track.target);
  if (!WRAPPER_PROPERTIES.has(track.property)) return element;
  const wrapper = element?.parentElement;
  return wrapper?.hasAttribute('data-anim') ? wrapper : undefined;
}

export function createPreview(sandbox: Target): Preview {
  // The one clock. It has no keyframes, so it changes nothing, and it keeps time even with no effects.
  const clock = sandbox.root.animate([], { duration: 1000, iterations: Infinity, fill: 'both' });
  clock.pause();
  clock.currentTime = 0;
  let duration = 1;
  let iterations = Infinity;
  const live = new Map<string, Animation>();
  const all = () => [clock, ...live.values()];
  const now = () => (clock.currentTime as number | null) ?? 0;

  return {
    apply(ir) {
      duration = ir.duration;
      iterations = ir.iterations === 'infinite' ? Infinity : 1;
      const timing = { duration: duration * 1000, iterations, fill: 'both' as const };
      clock.effect!.updateTiming(timing);

      const seen = new Set<string>();
      for (const track of ir.tracks) {
        // Stacked transforms share a target and property, so number them. Slots fill from 0, so
        // creation order, which decides WAAPI's composite order, follows the IR's track order.
        let n = 0;
        while (seen.has(`${track.target}|${track.property}|${n}`)) n++;
        const id = `${track.target}|${track.property}|${n}`;
        const property = camel(track.property);
        const keyframes = track.keyframes.map(({ offset, value, easing }) => ({ offset, easing, [property]: value }));
        const running = live.get(id);
        if (running) {
          const effect = running.effect as KeyframeEffect;
          effect.setKeyframes(keyframes);
          effect.updateTiming(timing);
        } else {
          const element = targetOf(sandbox, track);
          if (!element) continue;
          const composite = ADDITIVE_PROPERTIES.has(track.property) ? 'add' : 'replace';
          const animation = element.animate(keyframes, { ...timing, composite });
          animation.currentTime = now();
          if (clock.playState !== 'running') animation.pause();
          live.set(id, animation);
        }
        seen.add(id);
      }
      for (const [id, animation] of live) {
        if (seen.has(id)) continue;
        animation.cancel();
        live.delete(id);
      }
    },
    seek(seconds) {
      for (const animation of all()) animation.currentTime = seconds * 1000;
    },
    play() {
      // At the end of a timeline that does not loop, play() starts each one again from 0.
      for (const animation of all()) animation.play();
    },
    pause() {
      for (const animation of all()) animation.pause();
      const time = now();
      for (const animation of live.values()) animation.currentTime = time;
    },
    time() {
      const seconds = now() / 1000;
      return iterations === Infinity ? seconds % duration : Math.min(seconds, duration);
    },
    playing: () => clock.playState === 'running',
    destroy() {
      for (const animation of all()) animation.cancel();
      live.clear();
    },
  };
}

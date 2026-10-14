import { createPreview, type Preview } from '../core/backends/waapi';
import { compile } from '../core/ir/compile';
import type { IR } from '../core/ir/types';
import { project } from './project.svelte';
import type { Sandbox } from './sandbox';
import { editor } from './state.svelte';

// Play state and the playhead are view state, not part of the spec, and not undoable.
class Playback {
  /** The last compiled IR, for the notes it carries. */
  ir = $state.raw<IR | null>(null);
  playing = $state(false);
  /** Seconds into the timeline. */
  time = $state(0);
  #preview: Preview | undefined;
  #pending = false;
  #ticker = 0;

  attach(sandbox: Sandbox): () => void {
    const preview = createPreview(sandbox);
    this.#preview = preview;
    this.playing = false;
    this.time = 0;
    this.refresh();
    return () => {
      cancelAnimationFrame(this.#ticker);
      preview.destroy();
      if (this.#preview === preview) this.#preview = undefined;
    };
  }

  /** Recompiles at most once per frame. This is what keeps slider drags smooth. */
  update() {
    if (this.#pending) return;
    this.#pending = true;
    requestAnimationFrame(() => {
      this.#pending = false;
      this.refresh();
    });
  }

  /** Compiles the spec and brings the preview in line, now. */
  refresh() {
    const inventory = editor.inventory;
    if (!this.#preview || !inventory) return;
    this.ir = compile(project.spec, inventory);
    this.#preview.apply(this.ir);
    // A shorter timeline can leave the playhead past its end.
    if (!this.playing) this.time = this.#preview.time();
  }

  play() {
    if (!this.#preview) return;
    this.#preview.play();
    this.playing = true;
    const tick = () => {
      if (!this.#preview) return;
      this.time = this.#preview.time();
      // A timeline that does not loop stops by itself at the end.
      if (this.#preview.playing()) this.#ticker = requestAnimationFrame(tick);
      else this.playing = false;
    };
    tick();
  }

  pause() {
    cancelAnimationFrame(this.#ticker);
    this.#preview?.pause();
    this.playing = false;
    if (this.#preview) this.time = this.#preview.time();
  }

  seek(seconds: number) {
    this.#preview?.seek(seconds);
    this.time = seconds;
  }
}

export const playback = new Playback();

import { LIMITS, PipelineError } from '../core/parse';
import type { PipelineErrorCode } from '../core/parse/limits';
import { normaliseFile } from './pipeline';
import { editor } from './state.svelte';

const MESSAGES: Record<PipelineErrorCode, string> = {
  'too-large': 'That file is over 5 MB. Try a smaller one.',
  'too-many-elements': 'That file has too many shapes to animate smoothly.',
  'too-deep': 'That file is nested too deeply to work with.',
  'not-svg': "That doesn't look like an SVG file.",
  timeout: 'That file took too long to process.',
};

function fail(code: PipelineErrorCode): void {
  editor.status = 'error';
  editor.error = MESSAGES[code];
}

export async function loadText(text: string, name = 'Pasted SVG'): Promise<void> {
  editor.status = 'loading';
  editor.fileName = name;
  editor.originalBytes = new TextEncoder().encode(text).length;
  try {
    const result = await normaliseFile(text);
    editor.sandbox = undefined;
    editor.inventory = undefined;
    editor.result = result;
    editor.status = 'ready';
  } catch (error) {
    fail(error instanceof PipelineError ? error.code : 'not-svg');
  }
}

export async function loadFile(file: File): Promise<void> {
  // Checked before reading, so a huge file is never pulled into memory.
  if (file.size > LIMITS.bytes) return fail('too-large');
  await loadText(await file.text(), file.name);
}

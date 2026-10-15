// WebMCP: the editor's tools for AI agents in the browser (https://webmachinelearning.github.io/webmcp/).
// Chrome only so far, so everything is feature-detected. Tools only edit the spec (invariant 5):
// the preview, undo and autosave follow it as they do for a person.
import { compile } from '../core/ir/compile';
import { EFFECTS, SpecSchema } from '../core/spec/schema';
import { z } from '../core/spec/zod';
import { TEXT, type TextFormat } from './formats';
import { loadText } from './load';
import { playback } from './playback.svelte';
import { project } from './project.svelte';
import { visibleNodes } from './selection.svelte';
import { editor } from './state.svelte';

type Tool = {
  name: string;
  description: string;
  inputSchema?: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean };
  execute(input: Record<string, unknown>): Promise<unknown>;
};
type ModelContext = { registerTool(tool: Tool, options?: { signal?: AbortSignal }): Promise<void> };

// ponytail: layers past this are left out. Page through them if agents need huge files.
const MAX_LAYERS = 2000;

function loaded() {
  if (editor.status !== 'ready' || !editor.result || !editor.inventory)
    throw new Error('No SVG is open. Call load_svg, or ask the person to drop a file on the page.');
  return { result: editor.result, inventory: editor.inventory };
}

/** The drawing mounts after the pipeline finishes, so wait for its inventory. */
async function settled(): Promise<void> {
  for (let waited = 0; waited < 10_000; waited += 50) {
    if (editor.status === 'error') throw new Error(editor.error);
    if (editor.status === 'ready' && editor.inventory) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The drawing took too long to open.');
}

function describe() {
  const { inventory } = loaded();
  const nodes = visibleNodes();
  return {
    fileName: editor.fileName,
    layers: nodes.slice(0, MAX_LAYERS).map((node) => ({ key: node.key, name: project.nameOf(node), type: node.type, parent: node.parent })),
    layersOmitted: Math.max(0, nodes.length - MAX_LAYERS),
    spec: project.spec,
    warnings: compile(project.spec, inventory).notes,
    effects: Object.values(EFFECTS).map(({ type, label, pivot, minDuration, ui }) => ({ type, label, pivot, minDuration, params: ui })),
  };
}

const TOOLS: Tool[] = [
  {
    name: 'load_svg',
    description:
      'Open SVG markup in the editor, replacing the current drawing and its animation. The file is sanitised first. Returns the layers you can animate.',
    inputSchema: {
      type: 'object',
      properties: {
        svg: { type: 'string', description: 'The SVG markup. Up to 5 MB.' },
        name: { type: 'string', description: 'A file name to show, such as logo.svg.' },
      },
      required: ['svg'],
    },
    annotations: { consequentialHint: true },
    async execute({ svg, name }) {
      if (typeof svg !== 'string') throw new Error('svg must be a string.');
      await loadText(svg, typeof name === 'string' && name ? name.slice(0, 100) : 'Agent SVG');
      await settled();
      return describe();
    },
  },
  {
    name: 'get_document',
    description:
      'The open drawing: its layers (key, name, type, parent), the animation spec, warnings about the current animation, and the effects available with their settings.',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute() {
      return describe();
    },
  },
  {
    name: 'set_spec',
    description:
      'Replace the animation spec. Take the spec from get_document, change it and send it back whole. Effect targets are layer keys. Each effect needs a unique id. Omitted fields inside params use their defaults, so params: {} takes them all. One undo step for the person.',
    inputSchema: z.toJSONSchema(SpecSchema, { io: 'input' }),
    async execute(input) {
      loaded();
      const parsed = SpecSchema.safeParse(input);
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
      project.replace(parsed.data);
      if (!playback.playing && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
        playback.refresh();
        playback.play();
      }
      return { warnings: compile(parsed.data, editor.inventory!).notes };
    },
  },
  {
    name: 'export_animation',
    description:
      'The animation as text. svg: one animated SVG file that works in an <img>. css: inline SVG plus a style block. js: inline SVG plus a Web Animations API script. All respect prefers-reduced-motion. For GIF or MP4, ask the person to use the Export panel.',
    inputSchema: {
      type: 'object',
      properties: { format: { type: 'string', enum: Object.keys(TEXT) } },
      required: ['format'],
    },
    annotations: { readOnlyHint: true },
    async execute({ format }) {
      const { result, inventory } = loaded();
      if (typeof format !== 'string' || !Object.hasOwn(TEXT, format)) throw new Error('format must be svg, css or js.');
      const ir = compile(project.spec, inventory);
      if (!ir.tracks.length) throw new Error('Nothing is animated yet. Add an effect with set_spec first.');
      return TEXT[format as TextFormat].make(result.svg, ir);
    },
  },
];

/** Registers the tools if this browser supports WebMCP. Returns a function that removes them. */
export function registerAgentTools(): () => void {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!context) return () => {};
  const controller = new AbortController();
  // A refusal (the tools permission is off, say) just means no agent tools.
  for (const tool of TOOLS) context.registerTool(tool, { signal: controller.signal }).catch(() => {});
  return () => controller.abort();
}

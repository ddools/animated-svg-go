import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

// No test browser ships WebMCP yet, so a stand-in document.modelContext collects the tools.
declare global {
  interface Window {
    __tools: Record<string, { execute(input?: unknown): Promise<unknown>; inputSchema?: object; annotations?: object }>;
  }
}

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect id="box" x="20" y="20" width="60" height="60" fill="teal"/>
</svg>`;

async function open(page: Page) {
  await page.addInitScript(() => {
    window.__tools = {};
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: async (tool: { name: string }) => void (window.__tools[tool.name] = tool as never) },
    });
  });
  await page.goto('/editor');
  await page.waitForFunction(() => Object.keys(window.__tools).length === 4);
}

const call = (page: Page, name: string, input?: unknown) =>
  page.evaluate(([name, input]) => window.__tools[name as string].execute(input), [name, input] as const);

test('an agent loads, animates and exports an SVG', async ({ page }) => {
  await open(page);
  await expect(call(page, 'get_document')).rejects.toThrow('No SVG is open');

  const doc = (await call(page, 'load_svg', { svg: FIXTURE, name: 'box.svg' })) as {
    layers: { key: string; name: string }[];
    spec: { effects: unknown[] };
  };
  const box = doc.layers.find((layer) => layer.name === 'box')!;
  expect(box).toBeTruthy();
  await expect(page.getByText('box.svg')).toBeVisible();

  const spin = { id: 'spin1', type: 'spin', targets: [box.key], params: {}, timing: { start: 0, duration: 1, easing: { kind: 'spring', bounce: 0.3 }, iterations: 1, direction: 'normal' } };
  expect(await call(page, 'set_spec', { ...doc.spec, effects: [spin] })).toEqual({ warnings: [] });
  // The person sees it and can undo it.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const svg = (await call(page, 'export_animation', { format: 'svg' })) as string;
  expect(svg).toContain('@keyframes');
  expect(svg).toContain('prefers-reduced-motion');
});

test('bad input is refused, not applied', async ({ page }) => {
  await open(page);
  await call(page, 'load_svg', { svg: FIXTURE });
  await expect(call(page, 'set_spec', { version: 1, duration: 999, loop: true, effects: [] })).rejects.toThrow('duration');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(call(page, 'export_animation', { format: 'toString' })).rejects.toThrow('format must be');
  await expect(call(page, 'load_svg', { svg: 'not markup' })).rejects.toThrow();
});

test('reads are marked read-only and the spec schema is published', async ({ page }) => {
  await open(page);
  const tools = await page.evaluate(() =>
    Object.fromEntries(Object.entries(window.__tools).map(([name, tool]) => [name, { annotations: tool.annotations, schema: Boolean(tool.inputSchema) }])),
  );
  expect(tools.get_document.annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: true });
  expect(tools.export_animation.annotations).toMatchObject({ readOnlyHint: true });
  expect(tools.set_spec.schema).toBe(true);
});

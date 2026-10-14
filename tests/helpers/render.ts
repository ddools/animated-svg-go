import type { BrowserContext } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// Longest side of every render, in CSS pixels. Small icons are scaled up so a diff means something.
export const RENDER_SIZE = 512;

export type Shot = { png: Buffer; width: number; height: number };

/**
 * Renders an SVG the way an export is used: as an <img>. `box` forces the layout size,
 * which the normalised file needs because its fixed width and height were removed.
 */
export async function render(context: BrowserContext, svg: string, box?: { width: number; height: number }): Promise<Shot> {
  const page = await context.newPage();
  await page.route('http://render.test/**', (route) =>
    route.request().url().endsWith('.svg')
      ? route.fulfill({ contentType: 'image/svg+xml', body: svg })
      : route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#fff"><img id="i" src="/a.svg" style="display:block;transform-origin:0 0">' }),
  );
  await page.goto('http://render.test/');
  const size = await page.evaluate(async (forced) => {
    const img = document.querySelector<HTMLImageElement>('#i')!;
    await img.decode();
    const { width, height } = forced ?? img.getBoundingClientRect();
    // Pin the size in pixels. A file with no intrinsic size would otherwise follow the viewport.
    Object.assign(img.style, { width: `${width}px`, height: `${height}px` });
    return { width, height };
  }, box);
  const scale = RENDER_SIZE / Math.max(size.width, size.height);
  await page.evaluate((s) => (document.querySelector<HTMLElement>('#i')!.style.transform = `scale(${s})`), scale);
  const clip = { x: 0, y: 0, width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
  await page.setViewportSize({ width: Math.max(clip.width, 16), height: Math.max(clip.height, 16) });
  const png = await page.screenshot({ clip });
  await page.close();
  return { png, ...size };
}

export function compare(first: Buffer, second: Buffer): { ratio: number; diff: PNG } | { reason: string } {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  if (a.width !== b.width || a.height !== b.height) {
    return { reason: `render size changed from ${a.width}x${a.height} to ${b.width}x${b.height}` };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  return { ratio: differing / (a.width * a.height), diff };
}

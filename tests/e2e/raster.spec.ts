// GIF and MP4 export (M6). Encodes in the page, then reads the files back in Node: the MP4 with
// Mediabunny, the GIF by walking its blocks. Firefox runs in CI only.
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { expect, type Page } from '@playwright/test';
import type { IR } from '../../src/core/ir/types';
import { test } from '../helpers/strict';

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect id="box" x="20" y="20" width="60" height="60" fill="teal"/>
  <path id="line" d="M100 50H180" stroke="black" stroke-width="4"/>
</svg>`;
const SIZE = { width: 400, height: 200 };
const FPS = 10;

/** The fixture with a one-second spin on the box, looping. */
async function open(page: Page): Promise<{ svg: string; ir: IR }> {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE) });
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  return page.evaluate(() => {
    const { editor, project, playback } = window.__asg!;
    const key = [...editor.inventory!.nodes.values()].find((node) => node.label === 'box')!.key;
    const timing = { start: 0, duration: 1, easing: { kind: 'cubic', p: [0.42, 0, 0.58, 1] }, iterations: 1, direction: 'normal' };
    project.edit((spec) => Object.assign(spec, { duration: 1, loop: true, effects: [{ id: 'a', type: 'spin', targets: [key], params: { degrees: 90 }, timing }] }));
    playback.refresh();
    return { svg: editor.result!.svg, ir: playback.ir! };
  });
}

/** Image count, total delay in ms and loop count (null if absent) from a GIF's block structure. */
function readGif(bytes: Buffer): { frames: number; delay: number; loops: number | null; width: number; height: number } {
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * 2 ** ((bytes[10] & 7) + 1);
  const skipSubBlocks = () => {
    while (bytes[at] !== 0) at += bytes[at] + 1;
    at += 1;
  };
  let frames = 0;
  let delay = 0;
  let loops: number | null = null;
  for (;;) {
    const block = bytes[at];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = bytes[at + 1];
      if (label === 0xf9) delay += bytes.readUInt16LE(at + 4) * 10;
      if (label === 0xff && bytes.subarray(at + 3, at + 14).toString('latin1') === 'NETSCAPE2.0') loops = bytes.readUInt16LE(at + 16);
      at += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames += 1;
      const packed = bytes[at + 9];
      at += 10;
      if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1);
      at += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new Error(`Unexpected GIF block 0x${block.toString(16)} at ${at}`);
    }
  }
  return { frames, delay, loops, width, height };
}

test('a looping timeline exports as a GIF that loops, keeps time, and matches its estimate', async ({ page }) => {
  const { svg, ir } = await open(page);
  const out = await page.evaluate(
    async ([svg, ir, size, fps]) => {
      const { exportGif, estimateGif } = await window.__asg!.encoders();
      const options = { svg, ir, size, fps, background: '#ffffff' };
      const estimate = await estimateGif(options);
      const progress: number[] = [];
      const blob = await exportGif(options, (done) => progress.push(done));
      return { estimate, progress, bytes: [...new Uint8Array(await blob.arrayBuffer())], type: blob.type };
    },
    [svg, ir, SIZE, FPS] as const,
  );
  const gif = readGif(Buffer.from(out.bytes));
  expect(out.type).toBe('image/gif');
  expect(gif).toEqual({ frames: 10, delay: 1000, loops: 0, width: SIZE.width, height: SIZE.height });
  expect(out.progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // The roadmap's bar.
  expect(Math.abs(out.estimate - out.bytes.length) / out.bytes.length).toBeLessThan(0.25);
});

test('a timeline that plays once makes a GIF that stops on its last frame', async ({ page }) => {
  const { svg, ir } = await open(page);
  const bytes = await page.evaluate(
    async ([svg, ir, size, fps]) => {
      const { exportGif } = await window.__asg!.encoders();
      const blob = await exportGif({ svg, ir: { ...ir, iterations: 1 }, size, fps, background: '#ffffff' });
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    [svg, ir, SIZE, FPS] as const,
  );
  // One more frame than a loop: the end. A loop count of 0 would replay it.
  expect(readGif(Buffer.from(bytes))).toMatchObject({ frames: 11, loops: null });
});

test('an MP4 has every frame at the chosen size and lasts one pass', async ({ page }) => {
  const { svg, ir } = await open(page);
  const out = await page.evaluate(
    async ([svg, ir, size, fps]) => {
      const { canExportMp4, exportMp4 } = await window.__asg!.encoders();
      if (!(await canExportMp4(size))) return null;
      const blob = await exportMp4({ svg, ir, size, fps, background: '#ffffff' });
      return { bytes: [...new Uint8Array(await blob.arrayBuffer())], type: blob.type };
    },
    [svg, ir, SIZE, FPS] as const,
  );
  test.skip(out === null, 'This engine cannot encode H.264. The export panel offers GIF instead.');
  expect(out!.type).toBe('video/mp4');
  const input = new Input({ source: new BufferSource(new Uint8Array(out!.bytes)), formats: ALL_FORMATS });
  const track = (await input.getPrimaryVideoTrack())!;
  expect(track.codec).toBe('avc');
  expect([track.displayWidth, track.displayHeight]).toEqual([SIZE.width, SIZE.height]);
  expect((await track.computePacketStats()).packetCount).toBe(10);
  expect(await input.computeDuration()).toBeCloseTo(1, 2);
});

test('MP4 refuses odd sides, which H.264 cannot encode', async ({ page }) => {
  const { svg, ir } = await open(page);
  const out = await page.evaluate(
    async ([svg, ir]) => {
      const { canExportMp4, exportMp4 } = await window.__asg!.encoders();
      const size = { width: 401, height: 200 };
      const can = await canExportMp4(size);
      const made = await exportMp4({ svg, ir, size, fps: 10, background: '#fff' }).then(
        () => 'made',
        (error: Error) => error.message,
      );
      return { can, made };
    },
    [svg, ir] as const,
  );
  expect(out.can).toBe(false);
  expect(out.made).toMatch(/even sides/);
});

test('cancel stops an export part way through', async ({ page }) => {
  const { svg, ir } = await open(page);
  const out = await page.evaluate(
    async ([svg, ir, size]) => {
      const { exportGif } = await window.__asg!.encoders();
      const controller = new AbortController();
      let frames = 0;
      const result = await exportGif({ svg, ir, size, fps: 30, background: '#fff', signal: controller.signal }, (done) => {
        frames = done;
        if (done === 3) controller.abort();
      }).then(
        () => 'finished',
        (error: Error) => error.name,
      );
      return { result, frames };
    },
    [svg, ir, SIZE] as const,
  );
  expect(out).toEqual({ result: 'AbortError', frames: 3 });
});

test('the bench times every format it can encode', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForFunction(() => window.__asg !== undefined);
  const rows = await page.evaluate(() => window.__asg!.bench({ seconds: 0.5, fps: 10 }));
  const gifs = rows.filter((row) => row.format === 'gif');
  expect(gifs.map((row) => [row.width, row.height])).toEqual([
    [480, 270],
    [720, 406],
  ]);
  for (const row of rows) {
    expect(row.frames).toBe(5);
    expect(row.seconds).toBeGreaterThan(0);
    expect(row.megabytes).toBeGreaterThan(0);
  }
});

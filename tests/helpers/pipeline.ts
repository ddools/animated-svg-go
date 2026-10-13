import type { Page } from '@playwright/test';
import type { Normalised } from '../../src/core/parse';

export type Outcome = ({ ok: true } & Normalised) | { ok: false; code: string; message: string };

/** Opens the editor once per page and waits for the test hook. */
export async function openPipeline(page: Page): Promise<void> {
  await page.goto('/editor');
  await page.waitForFunction(() => window.__asg !== undefined);
}

/** Runs the real pipeline, worker included, inside the browser. */
export function normalise(page: Page, raw: string): Promise<Outcome> {
  return page.evaluate(async (input) => {
    try {
      return { ok: true as const, ...(await window.__asg!.normalise(input)) };
    } catch (error) {
      const e = error as { code?: string; message?: string };
      return { ok: false as const, code: e.code ?? 'unknown', message: e.message ?? String(error) };
    }
  }, raw);
}

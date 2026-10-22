import { expect, test as plain, type Page } from '@playwright/test';
import { test } from '../helpers/strict';

// Iconify is mocked, so CI never depends on it. The strict test still fails on a CSP violation.
const ROCKET = '<path fill="currentColor" d="M12 2s5 2 5 10H7c0-8 5-10 5-10"/><circle cx="12" cy="18" r="3"/>';
const SEARCH = {
  icons: ['mdi:rocket', 'mdi:rocket-copy', 'mdi:rocket-flipped', 'mdi:rocket-animated', 'bad name:<x>'],
  collections: { mdi: { name: 'Material Design Icons', license: { title: 'Apache 2.0' } } },
};

async function iconify(page: Page, body = ROCKET) {
  const urls: string[] = [];
  await page.route('https://api.iconify.design/**', (route) => {
    const url = new URL(route.request().url());
    urls.push(decodeURIComponent(url.pathname + url.search));
    if (url.pathname === '/search') return route.fulfill({ json: SEARCH });
    return route.fulfill({
      json: {
        prefix: 'mdi',
        width: 24,
        height: 24,
        icons: { rocket: { body }, 'rocket-animated': { body: '<path d="M0 0h9v9z" opacity="0"><animate attributeName="opacity" to="1"/></path>' } },
        // A plain alias is the same drawing. A flipped one is dropped, not drawn wrong.
        aliases: { 'rocket-copy': { parent: 'rocket' }, 'rocket-flipped': { parent: 'rocket', hFlip: true } },
      },
    });
  });
  return urls;
}

async function search(page: Page, words = 'rocket') {
  await page.goto('/editor');
  await page.getByRole('searchbox', { name: 'Search icons' }).fill(words);
  await page.getByRole('button', { name: 'Search' }).click();
}

const results = (page: Page) => page.getByRole('list', { name: 'Icons' }).getByRole('button');

test('nothing is sent until someone searches', async ({ page }) => {
  const urls = await iconify(page);
  await page.goto('/editor');
  await expect(page.getByRole('searchbox', { name: 'Search icons' })).toBeVisible();
  expect(urls).toEqual([]);
});

test('a searched icon loads like an upload', async ({ page }) => {
  const urls = await iconify(page);
  await search(page);
  // The malformed name never reaches a URL. The flipped alias and the SMIL-animated icon are dropped.
  await expect(results(page)).toHaveCount(2);
  await expect(results(page).first()).toHaveAccessibleName('rocket, Material Design Icons, Apache 2.0');
  // One request for the search and one per icon set.
  expect(urls).toEqual(['/search?query=rocket&limit=64', '/mdi.json?icons=rocket,rocket-copy,rocket-flipped,rocket-animated']);
  await results(page).first().click();
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  await expect(page.getByText('mdi-rocket.svg')).toBeVisible();
  const viewBox = await page.evaluate(() => document.querySelector('iframe')!.contentDocument!.querySelector('svg')!.getAttribute('viewBox'));
  expect(viewBox).toBe('0 0 24 24');
});

// The plain test: Chromium logs a CSP violation for the handler when the sanitiser parses it,
// as it does for any uploaded file (docs/ARCHITECTURE.md section 2).
plain('a hostile icon is sanitised like any file', async ({ page }) => {
  const requests: string[] = [];
  let fired = false;
  page.on('dialog', (dialog) => {
    fired = true;
    void dialog.dismiss();
  });
  await page.route('http://evil.test/**', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await iconify(page, '<script>alert(2)</script><image href="http://evil.test/pixel.png" width="5" height="5"/><rect width="5" height="5" onload="alert(1)"/>');
  await search(page);
  await results(page).first().click();
  await page.waitForFunction(() => window.__asg?.editor.inventory !== undefined);
  const markup = await page.evaluate(() => document.querySelector('iframe')!.contentDocument!.body.innerHTML);
  expect(markup).not.toMatch(/onload|<script|evil\.test/);
  await page.waitForTimeout(250);
  expect(fired).toBe(false);
  expect(requests).toEqual([]);
});

// The plain test: the failure is deliberate, so console errors are expected.
plain('a failed search says so', async ({ page }) => {
  await page.route('https://api.iconify.design/**', (route) => route.abort());
  await search(page);
  await expect(page.getByRole('alert')).toHaveText("Couldn't reach the icon search. Check your connection.");
});

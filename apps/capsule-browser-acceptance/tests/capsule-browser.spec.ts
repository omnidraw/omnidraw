import { expect, test } from '@playwright/test';

type TResult = Readonly<{
  name: string;
  pass: boolean;
  detail: string;
}>;

type TPublishedResult = Readonly<{
  format: string;
  state: string;
  passed: number;
  failed: number;
  results: readonly TResult[];
  outputs: readonly string[];
  fatalErrors: readonly string[];
  coordinator: unknown;
}>;

const REQUIRED_OUTPUTS = Object.freeze([
  'plain-ready:1:dark',
  'props:2',
  'theme:light',
  'svg-ready',
  'canvas-ready',
  'react-ready',
  'lifecycle:active:1',
  'collab-stream:0',
  'collab-stream:1',
  'published-ready:0:1:42:schema-rejected',
  'lifecycle:throttled:2',
]);

test('fresh signed Capsule guests pass the production browser boundary', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(`${error.name}: ${error.message}`);
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForFunction(
      () => ['passed', 'failed'].includes(document.documentElement.dataset.capsuleAcceptance ?? ''),
      undefined,
      { timeout: 120_000 },
    );
  } catch (error) {
    const state = await page.locator('html').getAttribute('data-capsule-acceptance');
    const diagnostics = await page.locator('#diagnostics').textContent();
    throw new Error(
      `Capsule browser acceptance did not terminate (state=${String(state)}, `
      + `pageErrors=${JSON.stringify(pageErrors)}, diagnostics=${String(diagnostics)}): `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const published = await page.evaluate(() => {
    return (window as Window & {
      __VIBECANVAS_CAPSULE_BROWSER_ACCEPTANCE__?: TPublishedResult;
    }).__VIBECANVAS_CAPSULE_BROWSER_ACCEPTANCE__ ?? null;
  });
  const detail = JSON.stringify(published, null, 2);

  expect(pageErrors, detail).toEqual([]);
  expect(published, detail).not.toBeNull();
  expect(published, detail).toMatchObject({
    format: 'vibecanvas.capsule-browser-acceptance-result.v1',
    state: 'passed',
    failed: 0,
    fatalErrors: [],
    coordinator: {
      destroyed: true,
      generation: null,
      handles: 0,
      hosts: [],
    },
  });
  expect(published?.results.length, detail).toBeGreaterThan(0);
  expect(published?.passed, detail).toBe(published?.results.length);
  expect(published?.results.every((result) => result.pass), detail).toBe(true);
  expect(new Set(published?.results.map((result) => result.name).filter(Boolean)).size, detail)
    .toBe(published?.results.length);
  expect(published?.outputs, detail).toEqual(expect.arrayContaining([...REQUIRED_OUTPUTS]));
  await expect(page.locator('#summary')).toHaveText(
    `PASSED: ${String(published?.passed)} passed, 0 failed`,
  );
  await expect(page.locator('#results > li[data-pass="true"]')).toHaveCount(published?.passed ?? -1);
  await expect(page.locator('#results > li[data-pass="false"]')).toHaveCount(0);
});

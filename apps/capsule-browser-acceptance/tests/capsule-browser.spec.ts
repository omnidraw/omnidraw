import { expect, test } from '@playwright/test';
import sharp from 'sharp';

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
  'three-ready:2',
  'react-css-ready:rgb(18,52,86)',
  'preview-functions-ready',
  'preview-functions-invoked:42',
  'lifecycle:active:1',
  'collab-stream:0',
  'collab-stream:1',
  'published-ready:0:1:42:schema-rejected',
  'lifecycle:throttled:2',
]);

const FORBIDDEN_NETWORK_IMAGE_PATH = '/capsule-network-image.svg';

function recordForbiddenNetworkImageRequest(
  requestUrl: string,
  recordedRequests: string[],
): void {
  const url = new URL(requestUrl);
  if (url.pathname === FORBIDDEN_NETWORK_IMAGE_PATH) {
    recordedRequests.push(url.href);
  }
}

test('forbidden network-image requests are recorded by the acceptance assertion', async ({ page }) => {
  const recordedRequests: string[] = [];
  page.on('request', (request) => {
    recordForbiddenNetworkImageRequest(request.url(), recordedRequests);
  });

  const response = await page.goto(FORBIDDEN_NETWORK_IMAGE_PATH, { waitUntil: 'load' });

  expect(response?.ok()).toBe(true);
  expect(recordedRequests.map((requestUrl) => new URL(requestUrl).pathname)).toEqual([
    FORBIDDEN_NETWORK_IMAGE_PATH,
  ]);
});

test('fresh signed Capsule guests pass the production browser boundary', async ({ page }) => {
  const pageErrors: string[] = [];
  const networkImageRequests: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(`${error.name}: ${error.message}`);
  });
  page.on('request', (request) => {
    recordForbiddenNetworkImageRequest(request.url(), networkImageRequests);
  });

  await page.goto('/?pixelHandshake=1', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(
    () => document.documentElement.dataset.capsuleThreeReady === 'true',
    undefined,
    { timeout: 120_000 },
  );
  try {
    const screenshot = await page.locator('[data-surface="three"]').screenshot();
    const { data, info } = await sharp(screenshot)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let orbPixels = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      if (blue > 80 && (red > 80 || green > 80)) orbPixels += 1;
    }
    expect(orbPixels).toBeGreaterThan(1_000);
  } finally {
    await page.evaluate(() => {
      (window as Window & {
        __OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE_ACK_THREE_PIXELS__?: () => void;
      }).__OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE_ACK_THREE_PIXELS__?.();
    });
  }

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
      __OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE__?: TPublishedResult;
    }).__OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE__ ?? null;
  });
  const detail = JSON.stringify(published, null, 2);

  expect(pageErrors, detail).toEqual([]);
  expect(published, detail).not.toBeNull();
  expect(published, detail).toMatchObject({
    format: 'omnidraw.capsule-browser-acceptance-result.v1',
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
  expect(networkImageRequests, detail).toEqual([]);
  await expect(page.locator('#summary')).toHaveText(
    `PASSED: ${String(published?.passed)} passed, 0 failed`,
  );
  await expect(page.locator('#results > li[data-pass="true"]')).toHaveCount(published?.passed ?? -1);
  await expect(page.locator('#results > li[data-pass="false"]')).toHaveCount(0);
});

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  readPlaywrightRuntimeExecutableEvidence,
  readPlaywrightRuntimeIdentity,
  readPlaywrightRuntimeIdentityFromEvidence,
  type TPlaywrightRuntimeIdentityPortal,
} from '../src/services/preview-inspection/playwright-runtime-identity';

const EXPECTED_SHA256 = 'a'.repeat(64);

function portal(
  overrides: Partial<TPlaywrightRuntimeIdentityPortal> = {},
): TPlaywrightRuntimeIdentityPortal {
  return {
    packageVersion: () => '1.61.1',
    executablePath: () => '/cache/ms-playwright/chromium-1228/chrome',
    executableVersion: async () => 'Google Chrome for Testing 149.0.7827.55\n',
    executableSha256: async () => EXPECTED_SHA256,
    ...overrides,
  };
}

describe('Playwright runtime identity', () => {
  test('reads package, revision, browser version, and checksum from independent sources', async () => {
    const identity = await readPlaywrightRuntimeIdentity(portal());

    expect(identity).toEqual({
      packageVersion: '1.61.1',
      browserName: 'chromium',
      browserRevision: '1228',
      browserVersion: '149.0.7827.55',
      executablePath: '/cache/ms-playwright/chromium-1228/chrome',
      executableSha256: EXPECTED_SHA256,
    });
  });

  test('hashes before the caller authorizes executable version discovery', async () => {
    const order: string[] = [];
    const testPortal = portal({
      executableSha256: async () => {
        order.push('hash');
        return EXPECTED_SHA256;
      },
      executableVersion: async () => {
        order.push('execute-version');
        return 'Google Chrome for Testing 149.0.7827.55';
      },
    });

    const evidence = await readPlaywrightRuntimeExecutableEvidence(testPortal);
    expect(order).toEqual(['hash']);
    expect(evidence).not.toHaveProperty('browserVersion');

    const identity = await readPlaywrightRuntimeIdentityFromEvidence(evidence, testPortal);
    expect(order).toEqual(['hash', 'execute-version']);
    expect(identity.browserVersion).toBe('149.0.7827.55');
  });

  test('accepts Windows separators and rejects a path without the managed revision', async () => {
    await expect(readPlaywrightRuntimeIdentity(portal({
      executablePath: () => 'C:\\cache\\ms-playwright\\chromium-1228\\chrome.exe',
    }))).resolves.toMatchObject({ browserRevision: '1228' });

    await expect(readPlaywrightRuntimeIdentity(portal({
      executablePath: () => '/usr/bin/chromium',
    }))).rejects.toMatchObject({
      code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
      message: 'The Playwright Chromium revision could not be verified.',
    });
  });

  test('rejects malformed executable version and checksum evidence', async () => {
    await expect(readPlaywrightRuntimeIdentity(portal({
      executableVersion: async () => 'Chromium unknown',
    }))).rejects.toMatchObject({
      code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
      message: 'The Playwright Chromium version is invalid.',
    });
    await expect(readPlaywrightRuntimeIdentity(portal({
      executableSha256: async () => 'not-a-checksum',
    }))).rejects.toMatchObject({
      code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
      message: 'The Playwright Chromium executable checksum is invalid.',
    });
  });

  test.skipIf(!existsSync(chromium.executablePath()))(
    'reads the real installed package and managed executable identity',
    async () => {
      const identity = await readPlaywrightRuntimeIdentity();

      expect(identity.packageVersion).toBe('1.61.1');
      expect(identity.browserRevision).toBe('1228');
      expect(identity.browserVersion).toBe('149.0.7827.55');
      expect(identity.executablePath).toBe(chromium.executablePath());
      expect(identity.executableSha256).toMatch(/^[a-f0-9]{64}$/);
    },
    20_000,
  );
});

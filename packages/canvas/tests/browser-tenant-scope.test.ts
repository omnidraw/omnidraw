import { describe, expect, test } from 'vitest';
import {
  fnBrowserTenantScopeKey,
  fnBrowserTenantScopesMatch,
  fnBrowserTenantStorageKeys,
  type TBrowserTenantScope,
} from '../src/fn.browser-tenant-scope';

const tenantA = Object.freeze({
  accountId: 'account-a',
  cellId: 'cell-a',
  deploymentOrigin: 'https://canvas.example',
  orgId: 'org-a',
  placementEpoch: 4,
}) satisfies TBrowserTenantScope;

describe('browser tenant storage isolation', () => {
  test('qualifies every persistent cache by deployment, org, account, cell, and epoch', () => {
    const variants = [
      { ...tenantA, orgId: 'org-b' },
      { ...tenantA, accountId: 'account-b' },
      { ...tenantA, cellId: 'cell-b' },
      { ...tenantA, placementEpoch: 5 },
      { ...tenantA, deploymentOrigin: 'https://other.example' },
    ];
    const keysA = fnBrowserTenantStorageKeys(tenantA);

    for (const variant of variants) {
      const keysB = fnBrowserTenantStorageKeys(variant);
      expect(keysB.cameraViewports).not.toBe(keysA.cameraViewports);
      expect(keysB.frontendStore).not.toBe(keysA.frontendStore);
    }
  });

  test('forces cache teardown on an organization or placement switch', () => {
    expect(fnBrowserTenantScopesMatch(tenantA, tenantA)).toBe(true);
    expect(fnBrowserTenantScopesMatch(tenantA, { ...tenantA, orgId: 'org-b' })).toBe(false);
    expect(fnBrowserTenantScopesMatch(tenantA, { ...tenantA, placementEpoch: 5 })).toBe(false);
    expect(fnBrowserTenantScopeKey({ ...tenantA, orgId: 'ab', accountId: 'c' })).not.toBe(
      fnBrowserTenantScopeKey({ ...tenantA, orgId: 'a', accountId: 'bc' }),
    );
  });
});

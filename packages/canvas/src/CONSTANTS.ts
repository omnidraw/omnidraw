import type { TBrowserTenantScope } from './fn.browser-tenant-scope';

/** Immutable OSS/local identity used until a trusted browser scope is injected. */
export const LOCAL_BROWSER_TENANT_SCOPE = Object.freeze({
  accountId: '00000000-0000-4000-8000-000000000002',
  cellId: '00000000-0000-4000-8000-000000000003',
  deploymentOrigin: 'http://localhost',
  orgId: '00000000-0000-4000-8000-000000000001',
  placementEpoch: 1,
}) satisfies TBrowserTenantScope;

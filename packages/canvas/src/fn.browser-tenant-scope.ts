import { fnScopedKey } from '@vibecanvas/tenant-core/fn.scoped-key';

export type TBrowserTenantScope = Readonly<{
  accountId: string;
  cellId: string;
  deploymentOrigin: string;
  orgId: string;
  placementEpoch: number;
}>;

export function fnBrowserTenantScopeKey(scope: TBrowserTenantScope): string {
  return fnScopedKey('browser-tenant', [
    scope.deploymentOrigin,
    scope.orgId,
    scope.accountId,
    scope.cellId,
    String(scope.placementEpoch),
  ]);
}

export function fnBrowserTenantStorageKeys(scope: TBrowserTenantScope): Readonly<{
  cameraViewports: string;
  frontendStore: string;
}> {
  const scopeKey = fnBrowserTenantScopeKey(scope);
  return Object.freeze({
    cameraViewports: `vibecanvas:camera:viewports:${scopeKey}`,
    frontendStore: `vibecanvas:frontend:${scopeKey}`,
  });
}

export function fnBrowserTenantScopesMatch(
  left: TBrowserTenantScope | null,
  right: TBrowserTenantScope,
): boolean {
  return left !== null && fnBrowserTenantScopeKey(left) === fnBrowserTenantScopeKey(right);
}

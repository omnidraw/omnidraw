import type { TBrowserTenantScope } from '@vibecanvas/canvas/fn.browser-tenant-scope';

export type TPortalSwitchBrowserTenant = {
  activateClientState(scope: TBrowserTenantScope): void;
  bootstrap(scope: TBrowserTenantScope): Promise<void>;
  connect(scope: TBrowserTenantScope): void;
  disconnect(): Promise<void>;
};

export type TArgsSwitchBrowserTenant = {
  scope: TBrowserTenantScope;
};

export async function txSwitchBrowserTenant(
  portal: TPortalSwitchBrowserTenant,
  args: TArgsSwitchBrowserTenant,
): Promise<void> {
  await portal.disconnect();
  portal.activateClientState(args.scope);
  portal.connect(args.scope);
  await portal.bootstrap(args.scope);
}

import type { TBrowserTenantScope } from '@omnidraw/canvas/fn.browser-tenant-scope';

type TTenantSwitchPortal = {
  switchTenant(scope: TBrowserTenantScope): Promise<void>;
};

function createSerializedTenantSwitcher(
  portal: TTenantSwitchPortal,
): (scope: TBrowserTenantScope) => Promise<void> {
  let switchTail = Promise.resolve();

  return (scope) => {
    const nextScope = Object.freeze({ ...scope });
    const switching = switchTail
      .catch(() => undefined)
      .then(() => portal.switchTenant(nextScope));
    switchTail = switching;
    return switching;
  };
}

export { createSerializedTenantSwitcher };

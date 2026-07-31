import { batch } from 'solid-js';
import type { TBrowserTenantScope } from '@omnidraw/canvas/fn.browser-tenant-scope';
import { switchFrontendStoreTenant } from '../store';
import { activateBrowserTenantScope } from './tenant';

function activateFrontendTenantState(scope: TBrowserTenantScope): void {
  batch(() => {
    switchFrontendStoreTenant(scope);
    activateBrowserTenantScope(scope);
  });
}

export { activateFrontendTenantState };

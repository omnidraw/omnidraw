import { cleanup } from './automerge';
import { orpcWebsocketService } from './orpc-websocket';
import { txSwitchBrowserTenant } from './tx.switch-browser-tenant';
import { createSerializedTenantSwitcher } from './tenant-switch-coordinator';
import { bootstrapFrontendCanvases } from './canvas-bootstrap';
import type { TBrowserTenantScope } from '@vibecanvas/canvas/fn.browser-tenant-scope';
import { activateFrontendTenantState } from './tenant-client-state';

const switchFrontendTenant = createSerializedTenantSwitcher({
  switchTenant: (scope: TBrowserTenantScope) => txSwitchBrowserTenant({
    activateClientState: activateFrontendTenantState,
    bootstrap: bootstrapFrontendCanvases,
    clearAutomerge: cleanup,
    connect: (nextScope) => orpcWebsocketService.connect(nextScope),
    disconnect: () => orpcWebsocketService.disconnect(),
  }, { scope }),
});

export { switchFrontendTenant };

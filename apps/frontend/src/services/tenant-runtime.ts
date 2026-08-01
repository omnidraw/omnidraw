import { orpcWebsocketService } from './orpc-websocket';
import { txSwitchBrowserTenant } from './tx.switch-browser-tenant';
import { createSerializedTenantSwitcher } from './tenant-switch-coordinator';
import { bootstrapFrontendCanvases } from './canvas-bootstrap';
import { activateFrontendTenantState } from './tenant-client-state';
import type { TBrowserTenantScope } from './fn.browser-tenant-scope';
import {
  frontendCanvasRuntimeRetirementCoordinator,
} from './canvas-runtime-retirement';

const switchFrontendTenant = createSerializedTenantSwitcher({
  switchTenant: (scope: TBrowserTenantScope) => txSwitchBrowserTenant({
    activateClientState: activateFrontendTenantState,
    bootstrap: bootstrapFrontendCanvases,
    connect: (nextScope) => orpcWebsocketService.connect(nextScope),
    disconnect: () => orpcWebsocketService.disconnect(),
    retireCanvasRuntimes: () => (
      frontendCanvasRuntimeRetirementCoordinator.retireAll()
    ),
  }, { scope }),
});

export { switchFrontendTenant };

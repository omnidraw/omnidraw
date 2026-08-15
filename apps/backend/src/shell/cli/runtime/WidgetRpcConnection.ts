import { createPrivateRpcConnection } from './PrivateRpcConnection';

export type { TPrivateRpcConnection as TWidgetRpcConnection } from './PrivateRpcConnection';

export function createWidgetRpcConnection(websocketUrl: string) {
  // Verification calls are not replay-safe: connection loss must be visible.
  return createPrivateRpcConnection({
    websocketUrl,
    retryTransientErrors: false,
  });
}

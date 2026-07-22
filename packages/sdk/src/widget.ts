export {
  __setServerFunctionTransport,
  createServerFunctionProxy,
  SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY,
} from './function-client';
export {
  __setCollaborativeStateTransport,
  changeCollaborativeState,
  COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY,
  getCollaborativeState,
  subscribeCollaborativeState,
} from './collaborative-state-client';
export type {
  ICollaborativeStateTransport,
  TCollaborativeStateSnapshot,
} from './collaborative-state-client';
export type {
  IServerFunctionClientTransport,
  TServerFunctionClient,
  TServerFunctionClientOf,
  TServerFunctionClientRequest,
} from './function-client';

export type {
  TWidgetManifestV2,
  TWidgetServerManifest,
  TWidgetUiManifest,
} from '@vibecanvas/widget-contract';

// The legacy `db` event stream is the current collaboration compatibility API.
// Its public route key stays `db` until a dedicated collaboration contract lands.
export { dbContract as collaborationContract } from '../db/contract';
export { dbHandlers as collaborationHandlers } from '../db/handlers';
export type { TDbApiContext as TCollaborationApiContext } from '../db/types';

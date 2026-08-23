import { Context, type Effect, type Stream } from 'effect';
import type { PrivateRpcError } from './rpc-contract';
import type { Json } from 'effect/Schema';
import type { TPrivateRequestPath, TPrivateStreamPath } from './operation-contract';

export interface IRpcDispatcher {
  readonly request: (args: Readonly<{
    path: TPrivateRequestPath;
    input: Json;
    idempotencyKey?: string;
  }>) => Effect.Effect<Json, PrivateRpcError>;
  readonly stream: (args: Readonly<{
    path: TPrivateStreamPath;
    input: Json;
    afterCursor?: number;
  }>) => Stream.Stream<Json, PrivateRpcError>;
}

export class RpcDispatcher extends Context.Service<RpcDispatcher, IRpcDispatcher>()(
  'omnidraw/backend/RpcDispatcher',
) {}

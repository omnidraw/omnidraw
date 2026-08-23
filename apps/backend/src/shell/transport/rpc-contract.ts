import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/unstable/rpc';
import {
  PrivateRequestPath,
  PrivateStreamPath,
} from './operation-contract';
import { PrivateRpcError, PrivateWireValue } from './private-rpc-error';

export { PrivateRpcError } from './private-rpc-error';

export const PrivateRequestRpc = Rpc.make('omnidraw.request.v1', {
  payload: {
    path: PrivateRequestPath,
    input: PrivateWireValue,
    idempotencyKey: Schema.optional(Schema.String),
  },
  success: PrivateWireValue,
  error: PrivateRpcError,
});

export const PrivateStreamRpc = Rpc.make('omnidraw.stream.v1', {
  payload: {
    path: PrivateStreamPath,
    input: PrivateWireValue,
    afterCursor: Schema.optional(Schema.Number),
  },
  success: PrivateWireValue,
  error: PrivateRpcError,
  stream: true,
});

export const PrivateTransportRpcs = RpcGroup.make(PrivateRequestRpc, PrivateStreamRpc);

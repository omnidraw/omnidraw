import { Schema } from 'effect';

export const PrivateWireValue = Schema.Json;

export class PrivateRpcError extends Schema.TaggedError<PrivateRpcError>()(
  'PrivateRpcError',
  {
    code: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    details: PrivateWireValue,
  },
) {}

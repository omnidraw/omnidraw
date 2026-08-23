import { Schema } from "effect";

/** Exact frontend view of the backend private RPC failure contract. */
export class PrivateRpcError extends Schema.TaggedError<PrivateRpcError>()(
  "PrivateRpcError",
  {
    code: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    details: Schema.Json,
  },
) {}

export function isPrivateRpcError(value: unknown): value is PrivateRpcError {
  return value instanceof PrivateRpcError
    || (typeof value === "object" && value !== null
      && (value as { _tag?: unknown })._tag === "PrivateRpcError"
      && typeof (value as { code?: unknown }).code === "string"
      && typeof (value as { status?: unknown }).status === "number");
}

import { Context, Effect, Schema, Stream } from "effect";
import { PrivateRpcError, isPrivateRpcError } from "./private-rpc-error";
import type {
  TPrivateRequestInput,
  TPrivateRequestOutput,
  TPrivateRequestPath,
  TPrivateStreamInput,
  TPrivateStreamOutput,
  TPrivateStreamPath,
} from "./private-operation-contract";

export class FrontendTransportError extends Schema.TaggedError<FrontendTransportError>()(
  "FrontendTransportError",
  {
    code: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    details: Schema.Unknown,
  },
) {}

export type TFrontendTransportFailure = PrivateRpcError | FrontendTransportError;

export type TFrontendTransportRequest<Path extends TPrivateRequestPath = TPrivateRequestPath> =
  Path extends TPrivateRequestPath
    ? Readonly<{
        path: Path;
        input: TPrivateRequestInput<Path>;
        idempotencyKey?: string;
        signal?: AbortSignal;
      }>
    : never;

export type TFrontendTransportStreamRequest<Path extends TPrivateStreamPath = TPrivateStreamPath> =
  Path extends TPrivateStreamPath
    ? Readonly<{
        path: Path;
        input: TPrivateStreamInput<Path>;
        afterCursor?: number;
        signal?: AbortSignal;
      }>
    : never;

export class FrontendTransport extends Context.Service<FrontendTransport, {
  request<Path extends TPrivateRequestPath>(request: TFrontendTransportRequest<Path>): Effect.Effect<TPrivateRequestOutput<Path>, TFrontendTransportFailure>;
  stream<Path extends TPrivateStreamPath>(request: TFrontendTransportStreamRequest<Path>): Stream.Stream<TPrivateStreamOutput<Path>, TFrontendTransportFailure>;
}>()("omnidraw/frontend/core/app/FrontendTransport") {}

export function frontendTransportFailure(error: unknown): TFrontendTransportFailure {
  if (isPrivateRpcError(error)) return error;
  const value = typeof error === "object" && error !== null
    ? error as Readonly<{ message?: unknown }>
    : null;
  return new FrontendTransportError({
    code: "TRANSPORT_FAILURE",
    status: 0,
    message: error instanceof Error
      ? error.message
      : typeof value?.message === "string"
        ? value.message
        : "The frontend transport failed.",
    details: null,
  });
}

export const fxFrontendRequest = <Path extends TPrivateRequestPath>(
  request: TFrontendTransportRequest<Path>,
): Effect.Effect<TPrivateRequestOutput<Path>, TFrontendTransportFailure, FrontendTransport> =>
  FrontendTransport.use((transport) => transport.request(request));

export const fxFrontendStream = <Path extends TPrivateStreamPath>(
  request: TFrontendTransportStreamRequest<Path>,
): Stream.Stream<TPrivateStreamOutput<Path>, TFrontendTransportFailure, FrontendTransport> =>
  Stream.unwrap(FrontendTransport.use((transport) => Effect.succeed(transport.stream(request))));

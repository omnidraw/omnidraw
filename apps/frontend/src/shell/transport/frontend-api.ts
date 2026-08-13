import { frontendTransportFailure } from "@/core/app/service.frontend-transport";
import type {
  TPrivateRequestArguments,
  TPrivateRequestInput,
  TPrivateRequestOutput,
  TPrivateRequestPath,
  TPrivateStreamArguments,
  TPrivateStreamOutput,
  TPrivateStreamPath,
} from "@/core/app/private-operation-contract";
import type { TApiError, TSafeResult } from "../framework/feature/sidebar/ports";
import type { FrontendRpcConnection } from "./rpc";

/** Operations whose current backend authority durably deduplicates this key. */
export const FRONTEND_IDEMPOTENT_MUTATION_PATHS: ReadonlySet<TPrivateRequestPath> = new Set([
  "canvas.execute",
]);

export function frontendIdempotencyKey(
  path: TPrivateRequestPath,
  input: unknown,
  explicit?: string,
): string | undefined {
  if (!FRONTEND_IDEMPOTENT_MUTATION_PATHS.has(path)) return undefined;
  if (explicit !== undefined) return explicit;
  if (path === "canvas.execute" && typeof input === "object" && input !== null) {
    const commandId = (input as Readonly<Record<string, unknown>>).commandId;
    return typeof commandId === "string" && commandId.length > 0 ? commandId : undefined;
  }
  return undefined;
}

export type TFrontendApi = Readonly<{
  safeRequest<Path extends TPrivateRequestPath>(
    path: Path,
    ...args: TPrivateRequestArguments<Path>
  ): Promise<TSafeResult<TPrivateRequestOutput<Path>>>;
  safeStream<Path extends TPrivateStreamPath>(
    path: Path,
    ...args: TPrivateStreamArguments<Path>
  ): Promise<TSafeResult<AsyncIterable<TPrivateStreamOutput<Path>>>>;
  widgetCatalogEvents(input: Readonly<{ afterGeneration?: number }>): AsyncIterable<TPrivateStreamOutput<"widget.catalog.events">>;
}>;

export function createFrontendApi(args: Readonly<{
  rpc: FrontendRpcConnection;
}>): TFrontendApi {
  const safeRequest = async <Path extends TPrivateRequestPath>(
    path: Path,
    ...requestArgs: TPrivateRequestArguments<Path>
  ): Promise<TSafeResult<TPrivateRequestOutput<Path>>> => {
    const [input = {}, options] = requestArgs;
    try {
      const idempotencyKey = frontendIdempotencyKey(path, input, options?.idempotencyKey);
      return [null, await args.rpc.request(path, input as TPrivateRequestInput<Path>, {
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      })];
    } catch (error) {
      return [frontendTransportFailure(error) as TApiError, undefined];
    }
  };

  const safeStream = async <Path extends TPrivateStreamPath>(
    path: Path,
    ...streamArgs: TPrivateStreamArguments<Path>
  ): Promise<TSafeResult<AsyncIterable<TPrivateStreamOutput<Path>>>> => {
    const [input = {}, options] = streamArgs;
    try {
      return [null, await args.rpc.stream(path, input as never, options)];
    } catch (error) {
      return [frontendTransportFailure(error) as TApiError, undefined];
    }
  };

  const widgetCatalogEvents = (
    input: Readonly<{ afterGeneration?: number }>,
  ): AsyncIterable<TPrivateStreamOutput<"widget.catalog.events">> => {
    const initial = input.afterGeneration;
    return args.rpc.resumableStream<"widget.catalog.events", number | undefined>({
      path: "widget.catalog.events",
      initialCursor: initial,
      input: (afterGeneration) => afterGeneration === undefined ? {} : { afterGeneration },
      advance: (cursor, event) => Math.max(cursor ?? 0, event.generation),
      isDuplicate: (cursor, event) => cursor !== undefined && event.generation <= cursor,
    });
  };

  return Object.freeze({
    safeRequest,
    safeStream,
    widgetCatalogEvents,
  });
}

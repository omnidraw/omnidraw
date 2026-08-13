import { Context, Effect, Layer, Schema, Stream } from "effect";
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSerialization,
} from "effect/unstable/rpc";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import * as Socket from "effect/unstable/socket/Socket";
import { PrivateRpcError } from "@/core/app/private-rpc-error";
import { fnJsonSafe } from "@/core/app/fn.json-safe";
import { fxRecoverAfterReconnect } from "@/core/app/fx.recover-after-reconnect";
import { frontendTransportFailure } from "@/core/app/service.frontend-transport";
import {
  PrivateRequestPath,
  PrivateStreamPath,
  PrivateWireValue,
  type TPrivateRequestArguments,
  type TPrivateRequestOutput,
  type TPrivateRequestPath,
  type TPrivateStreamInput,
  type TPrivateStreamOutput,
  type TPrivateStreamPath,
} from "@/core/app/private-operation-contract";

export const PrivateRequestRpc = Rpc.make("omnidraw.request.v1", {
  payload: {
    path: PrivateRequestPath,
    input: PrivateWireValue,
    idempotencyKey: Schema.optional(Schema.String),
  },
  success: PrivateWireValue,
  error: PrivateRpcError,
});

export const PrivateStreamRpc = Rpc.make("omnidraw.stream.v1", {
  payload: {
    path: PrivateStreamPath,
    input: PrivateWireValue,
    afterCursor: Schema.optional(Schema.Number),
  },
  success: PrivateWireValue,
  error: PrivateRpcError,
  stream: true,
});

const FrontendRpcs = RpcGroup.make(PrivateRequestRpc, PrivateStreamRpc);
type TClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof FrontendRpcs>,
  RpcClientError
>;

export class FrontendRpcClient extends Context.Service<FrontendRpcClient, TClient>()(
  "omnidraw/frontend/FrontendRpcClient",
) {}

export type TFrontendRpcConnectionSnapshot = Readonly<{
  connected: boolean;
  generation: number;
}>;

type TConnectionLease = Readonly<{
  id: number;
  signal: AbortSignal;
}>;

export class FrontendRpcStaleGenerationError extends Error {
  constructor() {
    super("The RPC operation belongs to a retired connection generation.");
    this.name = "FrontendRpcStaleGenerationError";
  }
}

/** Tracks logical connection generations independently from physical retry. */
export class FrontendRpcConnectionGenerations {
  #connected = false;
  #generation = 0;
  #leaseId = 0;
  #leaseController = new AbortController();
  #hasConnected = false;
  readonly #listeners = new Set<(state: TFrontendRpcConnectionSnapshot) => void>();

  snapshot(): TFrontendRpcConnectionSnapshot {
    return Object.freeze({
      connected: this.#connected,
      generation: this.#generation,
    });
  }

  lease(): TConnectionLease {
    return Object.freeze({
      id: this.#leaseId,
      signal: this.#leaseController.signal,
    });
  }

  assertCurrent(lease: TConnectionLease): void {
    if (lease.id !== this.#leaseId || lease.signal.aborted) {
      throw new FrontendRpcStaleGenerationError();
    }
  }

  connected(): void {
    if (this.#connected) return;
    if (this.#hasConnected) this.#rotateLease();
    this.#hasConnected = true;
    this.#connected = true;
    this.#generation += 1;
    this.#publish();
  }

  disconnected(): void {
    if (!this.#connected) return;
    this.#connected = false;
    this.#rotateLease();
    this.#publish();
  }

  subscribe(listener: (state: TFrontendRpcConnectionSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  waitForConnectionAfter(
    generation: number,
    signal?: AbortSignal,
  ): Promise<TFrontendRpcConnectionSnapshot> {
    const current = this.snapshot();
    if (current.connected && current.generation > generation) return Promise.resolve(current);
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      let unsubscribe = (): void => undefined;
      const onAbort = (): void => {
        unsubscribe();
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      unsubscribe = this.subscribe((state) => {
        if (!state.connected || state.generation <= generation) return;
        signal?.removeEventListener("abort", onAbort);
        unsubscribe();
        resolve(state);
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  #rotateLease(): void {
    this.#leaseController.abort(new FrontendRpcStaleGenerationError());
    this.#leaseController = new AbortController();
    this.#leaseId += 1;
  }

  #publish(): void {
    const state = this.snapshot();
    for (const listener of this.#listeners) listener(state);
  }
}

function awaitConnectedGenerationAfter(
  generations: FrontendRpcConnectionGenerations,
  generation: number,
): Effect.Effect<TFrontendRpcConnectionSnapshot> {
  return Effect.callback((resume) => {
    const current = generations.snapshot();
    if (current.connected && current.generation > generation) {
      resume(Effect.succeed(current));
      return;
    }
    let unsubscribe = (): void => undefined;
    unsubscribe = generations.subscribe((state) => {
      if (!state.connected || state.generation <= generation) return;
      unsubscribe();
      resume(Effect.succeed(state));
    });
    return Effect.sync(unsubscribe);
  });
}

export function frontendWebsocketUrl(originValue: string): string {
  const origin = new URL(originValue);
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  origin.pathname = "/rpc";
  origin.search = "";
  origin.hash = "";
  return origin.toString();
}

export function frontendRpcLayer(
  url: string,
  generations: FrontendRpcConnectionGenerations,
  createWebSocket: (url: string, protocols?: string | string[]) => WebSocket,
) {
  const connectionHooks = Layer.succeed(
    RpcClient.ConnectionHooks,
    RpcClient.ConnectionHooks.of({
      onConnect: Effect.sync(() => generations.connected()),
      onDisconnect: Effect.sync(() => generations.disconnected()),
    }),
  );
  return Layer.effect(
    FrontendRpcClient,
    RpcClient.make(FrontendRpcs),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolSocket({ retryTransientErrors: true })),
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(Layer.succeed(Socket.WebSocketConstructor, createWebSocket)),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(connectionHooks),
  );
}

function linkedSignal(
  generationSignal: AbortSignal,
  callerSignal?: AbortSignal,
): Readonly<{ signal: AbortSignal; dispose(): void }> {
  if (callerSignal === undefined) {
    return Object.freeze({ signal: generationSignal, dispose() {} });
  }
  const controller = new AbortController();
  const abortFromGeneration = () => controller.abort(generationSignal.reason);
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  generationSignal.addEventListener("abort", abortFromGeneration, { once: true });
  callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  if (generationSignal.aborted) abortFromGeneration();
  else if (callerSignal.aborted) abortFromCaller();
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      generationSignal.removeEventListener("abort", abortFromGeneration);
      callerSignal.removeEventListener("abort", abortFromCaller);
    },
  });
}

export type TFrontendResumableStreamOptions<
  Path extends TPrivateStreamPath,
  TCursor,
  TRecoveryEvent = never,
> = Readonly<{
  path: Path;
  initialCursor: TCursor;
  input(cursor: TCursor): TPrivateStreamInput<Path>;
  advance(cursor: TCursor, event: TPrivateStreamOutput<Path>): TCursor;
  isDuplicate?(cursor: TCursor, event: TPrivateStreamOutput<Path>): boolean;
  afterReconnect?(cursor: TCursor): Promise<readonly TRecoveryEvent[]>;
  signal?: AbortSignal;
}>;

export type TFrontendRpcRunner = <A, E>(
  program: Effect.Effect<A, E, FrontendRpcClient>,
  options?: Readonly<{ signal?: AbortSignal }>,
) => Promise<A>;

/** Application shell adapter over the single scoped Effect RPC connection. */
export class FrontendRpcConnection {
  readonly generations: FrontendRpcConnectionGenerations;
  readonly #runPromise: TFrontendRpcRunner;

  constructor(options: Readonly<{
    runPromise: TFrontendRpcRunner;
    generations?: FrontendRpcConnectionGenerations;
  }>) {
    this.generations = options.generations ?? new FrontendRpcConnectionGenerations();
    this.#runPromise = options.runPromise;
  }

  async request<Path extends TPrivateRequestPath>(
    path: Path,
    ...args: TPrivateRequestArguments<Path>
  ): Promise<TPrivateRequestOutput<Path>> {
    const [input = {}, options] = args;
    const lease = this.generations.lease();
    const linked = linkedSignal(lease.signal, options?.signal);
    try {
      const value = await this.#runPromise(
        FrontendRpcClient.use((client) => client["omnidraw.request.v1"]({
          path,
          input: fnJsonSafe(input),
          ...(options?.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: options.idempotencyKey }),
        })),
        { signal: linked.signal },
      );
      this.generations.assertCurrent(lease);
      return value as TPrivateRequestOutput<Path>;
    } catch (error) {
      this.generations.assertCurrent(lease);
      throw error;
    } finally {
      linked.dispose();
    }
  }

  async stream<Path extends TPrivateStreamPath>(
    path: Path,
    input: TPrivateStreamInput<Path>,
    options?: Readonly<{ afterCursor?: number; signal?: AbortSignal }>,
  ): Promise<AsyncIterable<TPrivateStreamOutput<Path>>> {
    const lease = this.generations.lease();
    const linked = linkedSignal(lease.signal, options?.signal);
    let iterable: AsyncIterable<unknown>;
    try {
      iterable = await this.#runPromise(
        FrontendRpcClient.use((activeClient) => Stream.toAsyncIterableEffect(
          activeClient["omnidraw.stream.v1"]({
          path,
          input: fnJsonSafe(input),
          ...(options?.afterCursor === undefined
            ? {}
            : { afterCursor: options.afterCursor }),
          }),
        )),
        { signal: linked.signal },
      );
      this.generations.assertCurrent(lease);
    } catch (error) {
      linked.dispose();
      this.generations.assertCurrent(lease);
      throw error;
    }
    const generations = this.generations;
    return {
      [Symbol.asyncIterator]() {
        const iterator = iterable[Symbol.asyncIterator]();
        let closed = false;
        const close = (): void => {
          if (closed) return;
          closed = true;
          linked.dispose();
        };
        return {
          async next() {
            try {
              generations.assertCurrent(lease);
              const next = await iterator.next();
              generations.assertCurrent(lease);
              if (next.done) close();
              return next as IteratorResult<TPrivateStreamOutput<Path>>;
            } catch (error) {
              close();
              generations.assertCurrent(lease);
              throw error;
            }
          },
          async return() {
            try {
              return await iterator.return?.() as IteratorResult<TPrivateStreamOutput<Path>> | undefined
                ?? { done: true as const, value: undefined };
            } finally {
              close();
            }
          },
        };
      },
    };
  }

  /** Reopens a domain stream only after a new physical connection generation. */
  resumableStream<Path extends TPrivateStreamPath, TCursor, TRecoveryEvent = never>(
    options: TFrontendResumableStreamOptions<Path, TCursor, TRecoveryEvent>,
  ): AsyncIterable<TPrivateStreamOutput<Path> | TRecoveryEvent> {
    const connection = this;
    return {
      async *[Symbol.asyncIterator]() {
        let cursor = options.initialCursor;
        while (!options.signal?.aborted) {
          let activeGeneration = connection.generations.snapshot().generation;
          try {
            const events = await connection.stream(
              options.path,
              options.input(cursor),
              { signal: options.signal },
            );
            activeGeneration = connection.generations.snapshot().generation;
            for await (const event of events) {
              const duplicate = options.isDuplicate?.(cursor, event) ?? false;
              cursor = options.advance(cursor, event);
              if (duplicate) continue;
              yield event;
            }
            const state = connection.generations.snapshot();
            if (state.connected && state.generation === activeGeneration) {
              throw new Error(`RPC stream '${options.path}' ended unexpectedly.`);
            }
          } catch (error) {
            if (options.signal?.aborted) return;
            const state = connection.generations.snapshot();
            if (state.connected && state.generation === activeGeneration) throw error;
          }
          let recoveryAfterGeneration = activeGeneration;
          while (!options.signal?.aborted) {
            const reconnected = await connection.generations.waitForConnectionAfter(
              recoveryAfterGeneration,
              options.signal,
            );
            if (options.afterReconnect === undefined) break;

            let recovery;
            try {
              recovery = await connection.#runPromise(fxRecoverAfterReconnect({
                expectedGeneration: reconnected.generation,
                observeGeneration: Effect.sync(() => connection.generations.snapshot()),
                awaitGenerationChange: awaitConnectedGenerationAfter(
                  connection.generations,
                  reconnected.generation,
                ),
                recover: Effect.tryPromise({
                  try: () => options.afterReconnect!(cursor),
                  catch: frontendTransportFailure,
                }),
              }), { signal: options.signal });
            } catch (error) {
              if (options.signal?.aborted) return;
              throw error;
            }
            if (recovery._tag === "GenerationChanged") {
              recoveryAfterGeneration = reconnected.generation;
              continue;
            }
            let current = connection.generations.snapshot();
            if (!current.connected || current.generation !== reconnected.generation) {
              recoveryAfterGeneration = reconnected.generation;
              continue;
            }
            let recoveryRetired = false;
            for (const event of recovery.events) {
              current = connection.generations.snapshot();
              if (!current.connected || current.generation !== reconnected.generation) {
                recoveryRetired = true;
                break;
              }
              yield event;
            }
            if (recoveryRetired) {
              recoveryAfterGeneration = reconnected.generation;
              continue;
            }
            break;
          }
        }
      },
    };
  }
}

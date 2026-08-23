import { Effect, Layer, Stream } from "effect";
import { fnJsonSafe } from "@/core/app/fn.json-safe";
import {
  FrontendTransport,
  frontendTransportFailure,
  type TFrontendTransportFailure,
  type TFrontendTransportRequest,
  type TFrontendTransportStreamRequest,
} from "@/core/app/service.frontend-transport";
import type {
  TPrivateRequestOutput,
  TPrivateRequestPath,
  TPrivateStreamOutput,
  TPrivateStreamPath,
} from "@/core/app/private-operation-contract";

export type TScriptedRequestOutcome =
  | Readonly<{ value: unknown }>
  | Readonly<{ failure: TFrontendTransportFailure }>
  | Readonly<{ committedValue: unknown; lostAcknowledgement: TFrontendTransportFailure }>;

export type TScriptedRequestRecord = Readonly<{
  path: string;
  input: unknown;
  idempotencyKey?: string;
  replayed: boolean;
}>;

/** Scripted private transport with explicit outcomes and commit/lost-ack replay. */
export class ScriptedFrontendTransport {
  readonly #requests = new Map<string, TScriptedRequestOutcome[]>();
  readonly #streams = new Map<string, readonly (readonly unknown[])[]>();
  readonly #streamOffsets = new Map<string, number>();
  readonly #streamRequests: Array<Readonly<{
    path: string;
    input: unknown;
    afterCursor?: number;
    signal?: AbortSignal;
  }>> = [];
  #closedStreams = 0;
  readonly #committed = new Map<string, unknown>();
  readonly #records: TScriptedRequestRecord[] = [];

  enqueueRequest(path: string, ...outcomes: readonly TScriptedRequestOutcome[]): void {
    const queue = this.#requests.get(path) ?? [];
    queue.push(...outcomes);
    this.#requests.set(path, queue);
  }

  enqueueStream(path: string, ...batches: readonly (readonly unknown[])[]): void {
    const current = this.#streams.get(path) ?? [];
    this.#streams.set(path, [...current, ...batches]);
  }

  request<Path extends TPrivateRequestPath>(request: TFrontendTransportRequest<Path>): TPrivateRequestOutput<Path> {
    const input = fnJsonSafe(request.input);
    const committed = request.idempotencyKey === undefined
      ? undefined
      : this.#committed.get(request.idempotencyKey);
    const replayed = request.idempotencyKey !== undefined
      && this.#committed.has(request.idempotencyKey);
    this.#records.push(Object.freeze({
      path: request.path,
      input,
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      replayed,
    }));
    if (replayed) return committed as TPrivateRequestOutput<Path>;
    const queue = this.#requests.get(request.path);
    const outcome = queue?.shift();
    if (outcome === undefined) throw new Error(`No simulated response is scripted for '${request.path}'.`);
    if ("failure" in outcome) throw outcome.failure;
    if ("committedValue" in outcome) {
      if (request.idempotencyKey === undefined) {
        throw new Error(`Commit/lost-ack outcome for '${request.path}' requires an idempotency key.`);
      }
      this.#committed.set(request.idempotencyKey, outcome.committedValue);
      throw outcome.lostAcknowledgement;
    }
    if (request.idempotencyKey !== undefined) this.#committed.set(request.idempotencyKey, outcome.value);
    return outcome.value as TPrivateRequestOutput<Path>;
  }

  stream<Path extends TPrivateStreamPath>(request: TFrontendTransportStreamRequest<Path>): AsyncIterable<TPrivateStreamOutput<Path>> {
    fnJsonSafe(request.input);
    this.#streamRequests.push(Object.freeze({ ...request }));
    const batches = this.#streams.get(request.path) ?? [];
    const offset = this.#streamOffsets.get(request.path) ?? 0;
    const events = batches[offset];
    if (events === undefined) throw new Error(`No simulated stream is scripted for '${request.path}'.`);
    this.#streamOffsets.set(request.path, offset + 1);
    const transport = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for (const event of events) {
            if (request.signal?.aborted) throw new Error("Simulated stream was aborted.");
            yield event as TPrivateStreamOutput<Path>;
          }
        } finally {
          transport.#closedStreams += 1;
        }
      },
    };
  }

  records(): readonly TScriptedRequestRecord[] {
    return [...this.#records];
  }

  streamRecords(): readonly Readonly<{ path: string; input: unknown; afterCursor?: number; signal?: AbortSignal }>[] {
    return [...this.#streamRequests];
  }

  closedStreamCount(): number {
    return this.#closedStreams;
  }

  layer(): Layer.Layer<FrontendTransport> {
    return Layer.succeed(FrontendTransport, FrontendTransport.of({
      request: <Path extends TPrivateRequestPath>(request: TFrontendTransportRequest<Path>) => Effect.try({
        try: () => this.request(request),
        catch: frontendTransportFailure,
      }),
      stream: <Path extends TPrivateStreamPath>(request: TFrontendTransportStreamRequest<Path>) => Stream.fromAsyncIterable(
        this.stream(request),
        frontendTransportFailure,
      ),
    }));
  }
}

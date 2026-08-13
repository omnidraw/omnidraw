import type {
  IWidgetStateHostPort,
  TWidgetHostSubject,
  TWidgetSerializableJsonValue,
  TWidgetStateEvent,
  TWidgetStateSnapshot,
} from "@omnidraw/sdk";
import type { FrontendRpcConnection } from "../transport/rpc";

type TBackendWidgetStateSnapshot<TValue> = Readonly<{
  version: number;
  state: TValue;
}>;

type TBackendWidgetStateResult<TValue> =
  | Readonly<{ status: "found" | "changed" | "conflict"; snapshot: TBackendWidgetStateSnapshot<TValue> }>
  | Readonly<{ status: "rate-limited"; retryAfterMs: number }>
  | Readonly<{ status: "unavailable" }>;

type TBackendWidgetStateEvent<TValue> = Readonly<{
  type: "changed" | "snapshot";
  snapshot: TBackendWidgetStateSnapshot<TValue>;
}>;

function snapshot<TValue extends TWidgetSerializableJsonValue>(
  value: TBackendWidgetStateSnapshot<TValue>,
): TWidgetStateSnapshot<TValue> {
  return Object.freeze({ version: value.version, value: value.state });
}

function identity(subject: TWidgetHostSubject) {
  return {
    canvasId: subject.canvasId,
    elementId: subject.elementId,
    widgetInstanceId: subject.widgetInstanceId,
  };
}

function stateFailure<TValue>(result: TBackendWidgetStateResult<TValue>): Error {
  if (result.status === "rate-limited") {
    return new Error(`Widget state is rate limited; retry after ${result.retryAfterMs}ms.`);
  }
  if (result.status === "unavailable") return new Error("Widget state is unavailable.");
  return new Error(`Unexpected widget state result '${result.status}'.`);
}

/** Adapts the private state authority to the SDK-owned host port. */
export function createWidgetCollaborativeStatePort(
  rpc: FrontendRpcConnection,
): IWidgetStateHostPort {
  return Object.freeze({
  get<TValue extends TWidgetSerializableJsonValue>(
    subject: TWidgetHostSubject,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<TWidgetStateSnapshot<TValue>> {
    return rpc.request(
      "widget.runtime.state.get",
      identity(subject),
      options,
    ).then((result) => {
      if (result.status !== "found") throw stateFailure(result);
      return snapshot(result.snapshot as TBackendWidgetStateSnapshot<TValue>);
    });
  },
  change<TValue extends TWidgetSerializableJsonValue>(
    subject: TWidgetHostSubject,
    expectedVersion: number,
    value: TValue,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<TWidgetStateSnapshot<TValue>> {
    return rpc.request(
      "widget.runtime.state.change",
      { ...identity(subject), expectedVersion, state: value },
      options,
    ).then((result) => {
      if (result.status === "conflict") throw new Error("Widget state changed concurrently.");
      if (result.status !== "changed") throw stateFailure(result);
      return snapshot(result.snapshot as TBackendWidgetStateSnapshot<TValue>);
    });
  },
  events<TValue extends TWidgetSerializableJsonValue>(
    subject: TWidgetHostSubject,
    afterVersion: number,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): AsyncIterable<TWidgetStateEvent<TValue>> {
    const events = rpc.resumableStream<"widget.runtime.state.events", number>({
      path: "widget.runtime.state.events",
      initialCursor: afterVersion,
      input: (cursor) => ({ ...identity(subject), afterVersion: cursor }),
      advance: (cursor, event) => Math.max(cursor, event.snapshot.version),
      isDuplicate: (cursor, event) => event.snapshot.version <= cursor,
      signal: options?.signal,
    });
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of events) {
          yield Object.freeze({
            type: "snapshot" as const,
            snapshot: snapshot(event.snapshot as TBackendWidgetStateSnapshot<TValue>),
          }) as TWidgetStateEvent<TValue>;
        }
      },
    };
  },
  });
}

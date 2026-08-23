import { Effect, Stream } from "effect";
import { FrontendTransport, fxFrontendRequest, fxFrontendStream } from "@/core/app/service.frontend-transport";

export type TRpcConformanceHarness = Readonly<{
  scriptCommitThenLoseAck(path: string, value: unknown): void;
  scriptFailure(path: string): void;
  runRequest<T>(program: Effect.Effect<T, unknown, FrontendTransport>): Promise<T>;
  scriptStream(path: string, events: readonly unknown[]): void;
  runStream<T>(program: Effect.Effect<AsyncIterable<T>, never, FrontendTransport>): Promise<AsyncIterable<T>>;
  streamRecords(): readonly Readonly<{ path: string; afterCursor?: number }>[];
  closedStreamCount(): number;
  records(): readonly Readonly<{
    path: string;
    input: unknown;
    idempotencyKey?: string;
    replayed: boolean;
  }>[];
}>;

/** Same retry/idempotency/JSON scenario for shell and simulated Layers. */
export async function rpcConformanceSuite(harness: TRpcConformanceHarness): Promise<void> {
  harness.scriptCommitThenLoseAck("canvas.execute", { revision: 1 });
  const request = {
    path: "canvas.execute",
    input: {
      commandId: "rpc-conformance-1",
      canvasId: "canvas-1",
      baseRevision: 0,
      operations: [],
      preconditions: [],
      optional: undefined,
    },
    idempotencyKey: "rpc-conformance-1",
  } as const;
  let firstFailed = false;
  try {
    await harness.runRequest(fxFrontendRequest(request));
  } catch {
    firstFailed = true;
  }
  if (!firstFailed) throw new Error("Commit-then-lost-ack must fail visibly on its first delivery.");
  const replay = await harness.runRequest(fxFrontendRequest(request));
  if (replay.revision !== 1) throw new Error("Idempotent replay did not recover the committed value.");
  const records = harness.records();
  if (records.length !== 2 || records[1]?.replayed !== true) throw new Error("Mutation replay was not deduplicated.");
  if ("optional" in (records[0]?.input as Record<string, unknown>)) throw new Error("Undefined payload field crossed JSON transport.");

  harness.scriptFailure("canvas.create");
  try {
    await harness.runRequest(fxFrontendRequest({ path: "canvas.create", input: { name: "Visible failure" } }));
    throw new Error("Non-idempotent lost acknowledgement was hidden.");
  } catch (error) {
    if (error instanceof Error && error.message === "Non-idempotent lost acknowledgement was hidden.") throw error;
  }
  const createRecords = harness.records().filter((record) => record.path === "canvas.create");
  if (createRecords.length !== 1 || createRecords[0]?.idempotencyKey !== undefined) {
    throw new Error("Non-idempotent mutation was replayed or assigned an unsafe key.");
  }

  harness.scriptStream("agent.events", [{ sequence: 7 }, { sequence: 8 }]);
  const stream = await harness.runStream(fxFrontendStream({
    path: "agent.events",
    input: { afterSequence: 6 },
    afterCursor: 6,
  }).pipe(Stream.toAsyncIterableEffect));
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done || first.value.sequence !== 7) throw new Error("Bounded stream did not deliver its first event.");
  await iterator.return?.();
  if (harness.streamRecords()[0]?.afterCursor !== 6) throw new Error("Stream cursor was not forwarded.");
  if (harness.closedStreamCount() !== 1) throw new Error("Canceled stream did not finalize.");
}

import { Effect, Stream } from "effect";
import { frontendTransportFailure } from "@/core/app/service.frontend-transport";
import { txDatabaseEventError } from "@/core/resources/tx.database-event-error";
import type { TFrontendRuntime } from "../runtime/frontend-runtime";

/**
 * Owns the Canvas-scoped database event subscription. The cursor is advanced
 * only after delivery, duplicate replay is ignored, and a restart/reset cursor
 * failure remains visible instead of silently leaving a dead subscription.
 */
export function startFrontendDatabaseEvents(
  runtime: TFrontendRuntime,
  canvasId: string,
): () => void {
  const lifetime = new AbortController();
  const events = runtime.rpc.resumableStream<"db.events", number>({
    path: "db.events",
    initialCursor: 0,
    input: (afterSequence) => ({ canvasId, afterSequence }),
    advance: (cursor, event) => Math.max(cursor, event.sequence),
    isDuplicate: (cursor, event) => event.sequence <= cursor,
    signal: lifetime.signal,
  });
  const cancel = runtime.fork(
    Stream.runForEach(
      Stream.fromAsyncIterable(events, frontendTransportFailure),
      () => Effect.sync(() => runtime.catalogInvalidation.invalidate("resources")),
    ),
    {
      onError(error) {
        if (lifetime.signal.aborted) return;
        void runtime.runPromise(txDatabaseEventError({ error }));
      },
    },
  );
  return () => {
    lifetime.abort("Canvas database event subscription disposed");
    cancel();
  };
}

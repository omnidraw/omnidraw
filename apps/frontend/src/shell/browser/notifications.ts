import { showErrorToast } from "../framework/components/ui/Toast";
import { txRouteNotificationToast } from "@/core/notifications/tx.route-notification-toast";
import type { TFrontendRuntime } from "../runtime/frontend-runtime";
import { Stream } from "effect";

/** Starts the generation-aware notification subscription owned by the shell. */
export function startFrontendNotifications(runtime: TFrontendRuntime): () => void {
  const events = runtime.rpc.resumableStream<"notification.events", number | undefined>({
    path: "notification.events",
    initialCursor: undefined,
    input: (afterSequence) => afterSequence === undefined ? {} : { afterSequence },
    advance: (cursor, event) => Math.max(cursor ?? 0, event.sequence),
    isDuplicate: (cursor, event) => cursor !== undefined && event.sequence <= cursor,
  });
  return runtime.fork(
    Stream.fromAsyncIterable(events, (cause) => cause).pipe(
      Stream.runForEach((event) => txRouteNotificationToast({ event })),
    ),
    {
      onError(error) {
        showErrorToast("Notifications disconnected", error instanceof Error ? error.message : String(error));
      },
    },
  );
}

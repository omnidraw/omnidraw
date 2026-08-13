import { Effect } from "effect";
import type { TFrontendTransportFailure } from "../app/service.frontend-transport";
import { NotificationSink } from "../notifications/service.notification-sink";

/** Keeps terminal database-stream failure presentation explicit and testable. */
export type TArgsDatabaseEventError = Readonly<{
  error: TFrontendTransportFailure;
}>;

export const txDatabaseEventError = Effect.fn('txDatabaseEventError')(function*(
  args: TArgsDatabaseEventError,
): Effect.fn.Return<void, never, NotificationSink> {
  const notifications = yield* NotificationSink;
  return yield* notifications.show({
    tone: "error",
    title: "Database updates disconnected",
    description: args.error.message,
  });
});

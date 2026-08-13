import { Effect } from "effect";
import type { TFrontendTransportFailure } from "../app/service.frontend-transport";
import { NotificationSink } from "../notifications/service.notification-sink";

/** Keeps terminal database-stream failure presentation explicit and testable. */
export function txDatabaseEventError(args: Readonly<{
  error: TFrontendTransportFailure;
}>): Effect.Effect<void, never, NotificationSink> {
  return NotificationSink.use((notifications) => notifications.show({
    tone: "error",
    title: "Database updates disconnected",
    description: args.error.message,
  }));
}

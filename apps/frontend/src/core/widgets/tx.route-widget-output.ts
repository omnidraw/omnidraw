import { Effect } from "effect";
import type { TWidgetNotificationOutput } from "@omnidraw/sdk";
import { NotificationSink } from "../notifications/service.notification-sink";

/** Maps the sole guest output action to a fixed-title application toast. */
export const txRouteWidgetOutput = (
  args: Readonly<{ output: TWidgetNotificationOutput }>,
): Effect.Effect<void, never, NotificationSink> =>
  NotificationSink.use((sink) => sink.show({
    tone: args.output.tone,
    title: "Widget",
    description: args.output.message,
  }));

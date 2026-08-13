import { Effect } from "effect";
import type { TWidgetNotificationOutput } from "@omnidraw/sdk";
import { NotificationSink } from "../notifications/service.notification-sink";

/** Maps the sole guest output action to a fixed-title application toast. */
export type TArgsRouteWidgetOutput = Readonly<{ output: TWidgetNotificationOutput }>;

export const txRouteWidgetOutput = Effect.fn('txRouteWidgetOutput')(function*(
  args: TArgsRouteWidgetOutput,
): Effect.fn.Return<void, never, NotificationSink> {
  const sink = yield* NotificationSink;
  return yield* sink.show({
    tone: args.output.tone,
    title: "Widget",
    description: args.output.message,
  });
});

import { Effect } from "effect";
import type { TNotificationEvent } from "../app/backend.types";
import { NotificationSink } from "./service.notification-sink";

export type TArgsRouteNotificationToast = Readonly<{ event: TNotificationEvent }>;

/** Lazy routing transaction over the semantic notification sink. */
export const txRouteNotificationToast = Effect.fn('txRouteNotificationToast')(function*(
  args: TArgsRouteNotificationToast,
): Effect.fn.Return<void, never, NotificationSink> {
  const sink = yield* NotificationSink;
  return yield* sink.show({
    tone: args.event.type,
    title: args.event.title,
    ...(args.event.description === undefined ? {} : { description: args.event.description }),
  });
});

import { Effect } from "effect";
import type { TNotificationEvent } from "../app/backend.types";
import { NotificationSink } from "./service.notification-sink";

/** Lazy routing transaction over the semantic notification sink. */
export const txRouteNotificationToast = (
  args: Readonly<{ event: TNotificationEvent }>,
): Effect.Effect<void, never, NotificationSink> =>
  NotificationSink.use((sink) => sink.show({
    tone: args.event.type,
    title: args.event.title,
    ...(args.event.description === undefined ? {} : { description: args.event.description }),
  }));

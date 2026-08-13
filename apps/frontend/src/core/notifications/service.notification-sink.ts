import { Context, Effect } from "effect";

export type TNotificationTone = "error" | "info" | "success" | "warning";

export class NotificationSink extends Context.Service<NotificationSink, {
  show(args: Readonly<{
    tone: TNotificationTone;
    title: string;
    description?: string;
  }>): Effect.Effect<void>;
}>()("omnidraw/frontend/core/notifications/NotificationSink") {}

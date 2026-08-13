import { Effect, Layer } from "effect";
import {
  NotificationSink,
  type TNotificationTone,
} from "@/core/notifications/service.notification-sink";

export type TRecordedNotification = Readonly<{
  tone: TNotificationTone;
  title: string;
  description?: string;
}>;

export class RecordedFrontendNotifications {
  readonly #entries: TRecordedNotification[] = [];

  show(entry: TRecordedNotification): void {
    this.#entries.push(Object.freeze({ ...entry }));
  }

  entries(): readonly TRecordedNotification[] {
    return [...this.#entries];
  }

  layer(): Layer.Layer<NotificationSink> {
    return Layer.succeed(NotificationSink, NotificationSink.of({
      show: (entry) => Effect.sync(() => this.show(entry)),
    }));
  }
}

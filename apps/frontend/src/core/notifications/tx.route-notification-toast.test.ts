import { describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { NotificationSink } from "./service.notification-sink";
import { txRouteNotificationToast } from "./tx.route-notification-toast";

describe("notification toast routing", () => {
  test("routes warning events to the semantic sink", async () => {
    const show = vi.fn(() => Effect.void);
    await Effect.runPromise(txRouteNotificationToast({
      event: { type: "warning", title: "Node.js unavailable", description: "Install Node.js and npm." },
    }).pipe(Effect.provideService(NotificationSink, NotificationSink.of({ show }))));
    expect(show).toHaveBeenCalledWith({
      tone: "warning",
      title: "Node.js unavailable",
      description: "Install Node.js and npm.",
    });
  });
});

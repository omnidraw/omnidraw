import { describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { NotificationSink } from "../notifications/service.notification-sink";
import { txRouteWidgetOutput } from "./tx.route-widget-output";

describe("widget output routing", () => {
  test.each(["info", "success", "error"] as const)(
    "maps %s to the semantic sink",
    async (tone) => {
      const show = vi.fn(() => Effect.void);
      await Effect.runPromise(txRouteWidgetOutput({
        output: { type: "notification", tone, message: "Operation complete" },
      }).pipe(Effect.provideService(NotificationSink, NotificationSink.of({ show }))));
      expect(show).toHaveBeenCalledWith({
        tone,
        title: "Widget",
        description: "Operation complete",
      });
    },
  );
});

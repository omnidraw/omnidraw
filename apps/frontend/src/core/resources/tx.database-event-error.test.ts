import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { PrivateRpcError } from "../app/private-rpc-error";
import { NotificationSink } from "../notifications/service.notification-sink";
import { txDatabaseEventError } from "./tx.database-event-error";

test("terminal database event failures stay visible through the semantic notification port", async () => {
  const notifications: unknown[] = [];
  const failure = new PrivateRpcError({
    code: "EVENT_CURSOR_INVALID",
    status: 409,
    message: "The database event cursor was reset by process restart.",
    details: null,
  });
  await Effect.runPromise(txDatabaseEventError({ error: failure }).pipe(
    Effect.provide(Layer.succeed(NotificationSink, NotificationSink.of({
      show: (notification) => Effect.sync(() => { notifications.push(notification); }),
    }))),
  ));
  expect(notifications).toEqual([{
    tone: "error",
    title: "Database updates disconnected",
    description: failure.message,
  }]);
});

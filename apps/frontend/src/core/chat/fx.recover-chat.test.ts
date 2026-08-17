import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ChatRecoveryBackend, fxRecoverChat, type TChatScope } from "./fx.recover-chat";

describe("fxRecoverChat", () => {
  test("reads each reconnect history without claiming session ownership", async () => {
    const calls: Array<Readonly<{ kind: "history"; scope: unknown }>> = [];
    const backend = ChatRecoveryBackend.of({
      history: (scope) => Effect.sync(() => {
        calls.push({ kind: "history", scope: structuredClone(scope) });
        return [{ role: "assistant", content: scope.sessionId }];
      }),
    });
    const scopes = [{
      canvasId: "canvas-1",
      componentId: "chat-manual",
      sessionId: "session-manual",
      approvalPolicy: { mode: "manual" },
    }, {
      canvasId: "canvas-1",
      componentId: "chat-auto",
      sessionId: "session-auto",
      approvalPolicy: { mode: "always-approve" },
    }] as const satisfies readonly TChatScope[];

    const recovered = await Effect.runPromise(Effect.all(
      scopes.map((scope) => fxRecoverChat(scope)),
      { concurrency: "unbounded" },
    ).pipe(Effect.provideService(ChatRecoveryBackend, backend)));

    expect(recovered.map((event) => event.sessionId).sort()).toEqual([
      "session-auto",
      "session-manual",
    ]);
    expect(calls.map((call) => call.kind)).toEqual(["history", "history"]);
    for (const scope of scopes) {
      expect(calls).toContainEqual({
        kind: "history",
        scope: {
          componentId: scope.componentId,
          sessionId: scope.sessionId,
        },
      });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ChatRecoveryBackend, fxRecoverChat, type TChatScope } from "./fx.recover-chat";

describe("fxRecoverChat", () => {
  test("re-establishes each reconnect with its own captured chat policy before history", async () => {
    const calls: Array<Readonly<{ kind: "connect" | "history"; scope: unknown }>> = [];
    const backend = ChatRecoveryBackend.of({
      connectReuse: (scope) => Effect.sync(() => {
        calls.push({ kind: "connect", scope: structuredClone(scope) });
      }),
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
    for (const scope of scopes) {
      const connectIndex = calls.findIndex((call) => call.kind === "connect"
        && (call.scope as TChatScope).sessionId === scope.sessionId);
      const historyIndex = calls.findIndex((call) => call.kind === "history"
        && (call.scope as Pick<TChatScope, "sessionId">).sessionId === scope.sessionId);
      expect(connectIndex).toBeGreaterThanOrEqual(0);
      expect(historyIndex).toBeGreaterThan(connectIndex);
      expect(calls[connectIndex]?.scope).toEqual(scope);
      expect(calls[historyIndex]?.scope).toEqual({
        componentId: scope.componentId,
        sessionId: scope.sessionId,
      });
    }
  });
});

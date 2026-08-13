import { fxRecoverChat } from "@/core/chat/fx.recover-chat";
import { fnAdvanceAgentEventCursor } from "@/core/chat/fn.agent-event-cursor";

export type TChatConformanceHarness = Readonly<{
  scriptRecovery(history: readonly unknown[]): void;
  runRecovery(program: ReturnType<typeof fxRecoverChat>): Promise<Readonly<{
    kind: "recovered-history";
    history: readonly unknown[];
  }>>;
  calls(): readonly string[];
}>;

/** Same reconnect-before-history and monotonic cursor scenario. */
export async function chatConformanceSuite(harness: TChatConformanceHarness): Promise<void> {
  harness.scriptRecovery([{ role: "assistant", content: "recovered" }]);
  const recovered = await harness.runRecovery(fxRecoverChat({
    canvasId: "canvas-1",
    componentId: "widget-1",
    sessionId: "session-1",
  }));
  if (harness.calls().join(",") !== "agent.chat.connect,agent.chat.history") {
    throw new Error("Chat history was read before reuse connection completed.");
  }
  if (recovered.kind !== "recovered-history" || recovered.history.length !== 1) throw new Error("Recovered history event is invalid.");
  let cursor = fnAdvanceAgentEventCursor(0, { sequence: 7 });
  cursor = fnAdvanceAgentEventCursor(cursor, { sequence: 6 });
  if (cursor !== 7) throw new Error("Agent cursor regressed on duplicate delivery.");
}

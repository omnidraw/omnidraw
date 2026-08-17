import { describe, expect, it } from "vitest";
import { PrivateRpcError } from "@/core/app/private-rpc-error";
import { normalizeAgentEvent, recoverChatEventStream } from "@/shell/chat/adapters";

const approval = {
  id: "approval-1",
  chatId: "chat-1",
  toolCallId: "tool-call-1",
  kind: "resource-data-write",
  summary: "Write one protected row",
  risk: "high",
  warnings: ["This changes shared data."],
  details: { resourceId: "db-1", table: "records" },
  createdAtSec: "2026-08-16T10:00:00.000Z",
  policyMode: "always-approve",
  decisionSource: "policy",
  reviewerReason: "Approved by the configured reviewer.",
} as const;

describe("AI Chat approval event adapter", () => {
  it.each([
    {
      type: "created" as const,
      decision: undefined,
      reason: "reviewer-unavailable",
    },
    {
      type: "resolved" as const,
      decision: "approve" as const,
      reason: "Approved by policy.",
    },
    {
      type: "canceled" as const,
      decision: undefined,
      reason: "execution-failed",
    },
  ])("preserves the canonical $type lifecycle and terminal provenance", ({ type, decision, reason }) => {
    const event = normalizeAgentEvent({
      kind: "approval",
      widgetId: "component-1",
      sessionId: "chat-1",
      type,
      action: type === "resolved" ? "created" : "resolved",
      approval,
      decision,
      reason,
    });

    expect(event).toEqual({
      kind: "approval",
      componentId: "component-1",
      sessionId: "chat-1",
      type,
      approval,
      ...(decision === undefined ? {} : { decision }),
      reason,
    });
  });

  it("rejects approval events without the canonical lifecycle field", () => {
    expect(normalizeAgentEvent({
      kind: "approval",
      widgetId: "component-1",
      sessionId: "chat-1",
      action: "resolved",
      approval,
      decision: "approve",
    })).toBeNull();
  });
});

describe("AI Chat stream recovery", () => {
  it("keeps listening through CHAT_BUSY without reading history", async () => {
    const busy = new PrivateRpcError({
      code: "CHAT_BUSY",
      status: 409,
      message: "Chat prompt operation is already active.",
      details: null,
    });
    let historyCalls = 0;
    await expect(recoverChatEventStream(busy, 7, async () => {
      historyCalls += 1;
      return { kind: "recovered-history" as const, history: [] };
    })).resolves.toEqual({ cursor: 7, events: [] });
    expect(historyCalls).toBe(0);
  });

  it("reads history for a replay gap and keeps listening if that history is busy", async () => {
    const gap = new PrivateRpcError({
      code: "EVENT_REPLAY_UNAVAILABLE",
      status: 409,
      message: "Replay gap.",
      details: { afterSequence: 0, earliestSequence: 282 },
    });
    const recovered = { kind: "recovered-history" as const, history: [{ role: "assistant" }] };
    await expect(recoverChatEventStream(gap, 0, async () => recovered)).resolves.toEqual({
      cursor: 281,
      events: [recovered],
    });
    await expect(recoverChatEventStream(gap, 0, async () => {
      throw new PrivateRpcError({
        code: "CHAT_BUSY",
        status: 409,
        message: "Chat prompt operation is already active.",
        details: null,
      });
    })).resolves.toEqual({ cursor: 281, events: [] });
  });
});

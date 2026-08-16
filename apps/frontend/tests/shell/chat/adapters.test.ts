import { describe, expect, it } from "vitest";
import { normalizeAgentEvent } from "@/shell/chat/adapters";

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

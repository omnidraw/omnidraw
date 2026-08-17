import { describe, expect, test } from "bun:test";
import { PrivateRpcError } from "@/core/app/private-rpc-error";
import {
  fnAdvanceAgentEventCursor,
  fnAgentReplayCursorAfterGap,
} from "./fn.agent-event-cursor";

describe("agent event cursor policy", () => {
  test("advances monotonically", () => {
    expect(fnAdvanceAgentEventCursor(7, { sequence: 9 })).toBe(9);
    expect(fnAdvanceAgentEventCursor(7, { sequence: 6 })).toBe(7);
  });

  test("resumes immediately before the retained tail for a typed replay gap", () => {
    const failure = new PrivateRpcError({
      code: "EVENT_REPLAY_UNAVAILABLE",
      status: 409,
      message: "Replay gap.",
      details: { afterSequence: 0, earliestSequence: 282 },
    });
    expect(fnAgentReplayCursorAfterGap(failure, 0)).toBe(281);
  });

  test("rejects future, mismatched, and malformed cursor diagnostics", () => {
    expect(fnAgentReplayCursorAfterGap(new PrivateRpcError({
      code: "EVENT_CURSOR_INVALID",
      status: 409,
      message: "Future cursor.",
      details: { afterSequence: 300, currentSequence: 282 },
    }), 300)).toBeNull();
    expect(fnAgentReplayCursorAfterGap(new PrivateRpcError({
      code: "EVENT_REPLAY_UNAVAILABLE",
      status: 409,
      message: "Wrong request cursor.",
      details: { afterSequence: 1, earliestSequence: 282 },
    }), 0)).toBeNull();
    expect(fnAgentReplayCursorAfterGap(new PrivateRpcError({
      code: "EVENT_REPLAY_UNAVAILABLE",
      status: 409,
      message: "Malformed boundary.",
      details: { afterSequence: 0, earliestSequence: 1.5 },
    }), 0)).toBeNull();
  });
});

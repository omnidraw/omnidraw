import { describe, expect, test } from "bun:test";
import { PrivateRpcError } from "@/core/app/private-rpc-error";
import {
  fnChatConnectBusyHistoryFallback,
  fnRecoverChatStreamAfterDomainError,
} from "./fn.recover-chat-stream";

describe("chat stream domain recovery", () => {
  test("keeps listening through CHAT_BUSY without a second connect", () => {
    const busy = new PrivateRpcError({
      code: "CHAT_BUSY",
      status: 409,
      message: "Chat prompt operation is already active.",
      details: null,
    });
    expect(fnRecoverChatStreamAfterDomainError(busy, 7)).toEqual({ kind: "keep-listening" });
  });

  test("reads a typed replay gap and ignores unrelated connected failures", () => {
    const gap = new PrivateRpcError({
      code: "EVENT_REPLAY_UNAVAILABLE",
      status: 409,
      message: "Replay gap.",
      details: { afterSequence: 0, earliestSequence: 282 },
    });
    expect(fnRecoverChatStreamAfterDomainError(gap, 0)).toEqual({
      kind: "replay-gap",
      cursor: 281,
    });
    expect(fnRecoverChatStreamAfterDomainError(new PrivateRpcError({
      code: "EVENT_CURSOR_INVALID",
      status: 409,
      message: "Future cursor.",
      details: null,
    }), 10)).toBeNull();
  });

  test("reuses history on CHAT_BUSY only when connect is not a replacement", () => {
    expect(fnChatConnectBusyHistoryFallback("reuse")).toBe(true);
    expect(fnChatConnectBusyHistoryFallback(undefined)).toBe(true);
    expect(fnChatConnectBusyHistoryFallback("replace")).toBe(false);
  });
});

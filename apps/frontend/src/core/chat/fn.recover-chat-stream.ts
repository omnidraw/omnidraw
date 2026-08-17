import { isPrivateRpcError } from "../app/private-rpc-error";
import { fnAgentReplayCursorAfterGap } from "./fn.agent-event-cursor";

export type TChatStreamDomainRecovery =
  | Readonly<{ kind: "keep-listening" }>
  | Readonly<{ kind: "replay-gap"; cursor: number }>;

/** Prompt ownership is not a lost event stream. Replay gaps still need history. */
export function fnRecoverChatStreamAfterDomainError(
  error: unknown,
  cursor: number,
): TChatStreamDomainRecovery | null {
  if (isPrivateRpcError(error) && error.code === "CHAT_BUSY") {
    return Object.freeze({ kind: "keep-listening" as const });
  }
  const replayCursor = fnAgentReplayCursorAfterGap(error, cursor);
  if (replayCursor === null) return null;
  return Object.freeze({ kind: "replay-gap" as const, cursor: replayCursor });
}

/** Reuse may attach to a live prompt. Replace must still fail closed. */
export function fnChatConnectBusyHistoryFallback(
  mode: "reuse" | "replace" | undefined,
): boolean {
  return mode !== "replace";
}

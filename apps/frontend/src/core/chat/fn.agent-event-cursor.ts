export type TSequencedAgentEvent = Readonly<{ sequence?: unknown }>;

/** Advances monotonically and ignores malformed or duplicate event cursors. */
export function fnAdvanceAgentEventCursor(
  cursor: number,
  event: TSequencedAgentEvent,
): number {
  return typeof event.sequence === "number" && Number.isFinite(event.sequence)
    ? Math.max(cursor, event.sequence)
    : cursor;
}

/** Converts a typed bounded-replay gap into the cursor immediately before its retained tail. */
export function fnAgentReplayCursorAfterGap(error: unknown, cursor: number): number | null {
  if (typeof error !== "object" || error === null) return null;
  const failure = error as { code?: unknown; details?: unknown };
  if (failure.code !== "EVENT_REPLAY_UNAVAILABLE") return null;
  if (typeof failure.details !== "object" || failure.details === null) return null;
  const details = failure.details as { afterSequence?: unknown; earliestSequence?: unknown };
  if (
    !Number.isSafeInteger(details.afterSequence)
    || !Number.isSafeInteger(details.earliestSequence)
    || details.afterSequence !== cursor
    || (details.earliestSequence as number) < 1
    || (details.afterSequence as number) >= (details.earliestSequence as number) - 1
  ) {
    return null;
  }
  return (details.earliestSequence as number) - 1;
}

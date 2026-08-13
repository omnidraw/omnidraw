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

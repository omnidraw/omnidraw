export type TWidgetStateMutationRateLedger = Readonly<{
  lastSeenAt: number;
  timestamps: readonly number[];
}>;

export type TWidgetStateMutationRateLedgerEntry = readonly [
  scope: string,
  ledger: TWidgetStateMutationRateLedger,
];

export type TWidgetStateMutationAdmission =
  | Readonly<{ allowed: true }>
  | Readonly<{
    allowed: false;
    retryAfterMs: number;
  }>;

export type TWidgetStateMutationRateTransition = Readonly<{
  admission: TWidgetStateMutationAdmission;
  ledgers: readonly TWidgetStateMutationRateLedgerEntry[];
}>;

export type TArgsTransitionWidgetStateMutationRate = Readonly<{
  scope: string;
  now: number;
  limit: number;
  windowMs: number;
  maxLedgers: number;
  ledgers: readonly TWidgetStateMutationRateLedgerEntry[];
}>;

function fnLedgerEntry(
  scope: string,
  lastSeenAt: number,
  timestamps: readonly number[],
): TWidgetStateMutationRateLedgerEntry {
  return Object.freeze([
    scope,
    Object.freeze({
      lastSeenAt,
      timestamps: Object.freeze([...timestamps]),
    }),
  ]);
}

function fnEarliestMutationRetryAfter(
  ledgers: readonly TWidgetStateMutationRateLedgerEntry[],
  now: number,
  windowMs: number,
): number {
  let retryAfterMs = windowMs;
  for (const [, ledger] of ledgers) {
    const first = ledger.timestamps[0];
    if (first === undefined) continue;
    retryAfterMs = Math.min(
      retryAfterMs,
      Math.max(1, first + windowMs - now),
    );
  }
  return retryAfterMs;
}

export function fnPruneWidgetStateMutationRateLedger(
  ledger: TWidgetStateMutationRateLedger,
  now: number,
  windowMs: number,
): TWidgetStateMutationRateLedger | null {
  const cutoff = now - windowMs;
  let firstRetained = 0;
  while (
    firstRetained < ledger.timestamps.length
    && ledger.timestamps[firstRetained]! <= cutoff
  ) firstRetained += 1;
  if (firstRetained === ledger.timestamps.length) return null;
  if (firstRetained === 0) return ledger;
  return Object.freeze({
    lastSeenAt: ledger.lastSeenAt,
    timestamps: Object.freeze(ledger.timestamps.slice(firstRetained)),
  });
}

export function fnWidgetStateMutationCapacityRetryAfter(
  ledgers: readonly TWidgetStateMutationRateLedgerEntry[],
  now: number,
  windowMs: number,
): number {
  return fnEarliestMutationRetryAfter(ledgers, now, windowMs);
}

/** Hot-scope policy: the shell owns lookup and this transition touches one ledger. */
export function fnTransitionWidgetStateMutationLedger(args: Readonly<{
  ledger: TWidgetStateMutationRateLedger | undefined;
  now: number;
  limit: number;
  windowMs: number;
}>): Readonly<{
  admission: TWidgetStateMutationAdmission;
  firstRetained: number;
  lastSeenAt: number;
  appendTimestamp?: number;
}> {
  const timestamps = args.ledger?.timestamps ?? [];
  const cutoff = args.now - args.windowMs;
  let firstRetained = 0;
  while (
    firstRetained < timestamps.length
    && timestamps[firstRetained]! <= cutoff
  ) firstRetained += 1;
  const lastSeenAt = Math.max(args.ledger?.lastSeenAt ?? args.now, args.now);
  if (timestamps.length - firstRetained >= args.limit) {
    return Object.freeze({
      admission: Object.freeze({
        allowed: false,
        retryAfterMs: Math.max(
          1,
          timestamps[firstRetained]! + args.windowMs - args.now,
        ),
      }),
      firstRetained,
      lastSeenAt,
    });
  }
  return Object.freeze({
    admission: Object.freeze({ allowed: true }),
    firstRetained,
    lastSeenAt,
    appendTimestamp: args.now,
  });
}

/** Fixed-window admission with no clock, lifecycle, or mutable ledger ownership. */
export function fnTransitionWidgetStateMutationRate(
  args: TArgsTransitionWidgetStateMutationRate,
): TWidgetStateMutationRateTransition {
  const cutoff = args.now - args.windowMs;
  const ledgers: TWidgetStateMutationRateLedgerEntry[] = [];
  for (const [scope, ledger] of args.ledgers) {
    let firstRetained = 0;
    while (
      firstRetained < ledger.timestamps.length
      && ledger.timestamps[firstRetained]! <= cutoff
    ) {
      firstRetained += 1;
    }
    if (firstRetained === ledger.timestamps.length) continue;
    ledgers.push(fnLedgerEntry(
      scope,
      ledger.lastSeenAt,
      ledger.timestamps.slice(firstRetained),
    ));
  }

  const targetIndex = ledgers.findIndex(([scope]) => scope === args.scope);
  if (targetIndex === -1 && ledgers.length >= args.maxLedgers) {
    return Object.freeze({
      admission: Object.freeze({
        allowed: false,
        retryAfterMs: fnEarliestMutationRetryAfter(
          ledgers,
          args.now,
          args.windowMs,
        ),
      }),
      ledgers: Object.freeze(ledgers),
    });
  }

  const current = targetIndex === -1
    ? Object.freeze({ lastSeenAt: args.now, timestamps: Object.freeze([]) })
    : ledgers[targetIndex]![1];
  const lastSeenAt = Math.max(current.lastSeenAt, args.now);
  if (current.timestamps.length >= args.limit) {
    const next = fnLedgerEntry(args.scope, lastSeenAt, current.timestamps);
    if (targetIndex === -1) ledgers.push(next);
    else ledgers[targetIndex] = next;
    return Object.freeze({
      admission: Object.freeze({
        allowed: false,
        retryAfterMs: Math.max(
          1,
          current.timestamps[0]! + args.windowMs - args.now,
        ),
      }),
      ledgers: Object.freeze(ledgers),
    });
  }

  const next = fnLedgerEntry(
    args.scope,
    lastSeenAt,
    [...current.timestamps, args.now],
  );
  if (targetIndex === -1) ledgers.push(next);
  else ledgers[targetIndex] = next;
  return Object.freeze({
    admission: Object.freeze({ allowed: true }),
    ledgers: Object.freeze(ledgers),
  });
}

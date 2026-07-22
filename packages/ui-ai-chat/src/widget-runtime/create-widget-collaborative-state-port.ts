import {
  fnNormalizeWidgetCollaborativeJson,
  fnReadWidgetCollaborativeStateDocument,
  fnWidgetCollaborativeStateIdentitiesMatch,
} from './fn.collaborative-state-json';
import type {
  TWidgetCollaborativeJsonValue,
  TWidgetCollaborativeStateDocumentPort,
  TWidgetCollaborativeStateIdentity,
  TWidgetCollaborativeStatePort,
  TWidgetCollaborativeStateSession,
  TWidgetCollaborativeStateSnapshot,
} from './interface';

const MAX_PENDING_STATE_WAITS = 32;
const MUTATION_RATE_LIMIT = 20;
const MUTATION_RATE_WINDOW_MS = 1_000;
const WAIT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,170}$/;

type TCreateWidgetCollaborativeStatePortArgs = Readonly<{
  openDocument(args: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    signal: AbortSignal;
  }>): Promise<TWidgetCollaborativeStateDocumentPort>;
  isIdentityCurrent(identity: TWidgetCollaborativeStateIdentity): boolean;
  nowMs(): number;
}>;

type TPendingWait = Readonly<{
  resolve(snapshot: TWidgetCollaborativeStateSnapshot): void;
  reject(error: Error): void;
}>;

function cancelledError(): Error {
  return new Error('Widget collaborative state session is disposed.');
}

function createSession(
  documentPort: TWidgetCollaborativeStateDocumentPort,
  identity: TWidgetCollaborativeStateIdentity,
  isCurrent: () => boolean,
  nowMs: () => number,
): TWidgetCollaborativeStateSession {
  let disposed = false;
  let failure: Error | null = null;
  let version = 1;
  let current = fnReadWidgetCollaborativeStateDocument(documentPort.read(), identity);
  let canonical = JSON.stringify(current);
  const pending = new Map<string, TPendingWait>();
  const mutationTimes: number[] = [];
  let lastNowMs = -1;

  const assertActive = () => {
    if (disposed) throw cancelledError();
    if (failure) throw failure;
    if (!isCurrent()) {
      throw new Error('Widget collaborative state authority is no longer current.');
    }
  };

  const snapshot = (): TWidgetCollaborativeStateSnapshot => Object.freeze({
    version,
    value: fnNormalizeWidgetCollaborativeJson(current),
  });

  const settlePending = () => {
    if (pending.size === 0) return;
    const next = snapshot();
    for (const waiter of pending.values()) waiter.resolve(next);
    pending.clear();
  };

  const fail = (error: unknown) => {
    if (failure || disposed) return;
    failure = error instanceof Error
      ? error
      : new Error('Widget collaborative state became unavailable.');
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
  };

  const refresh = () => {
    try {
      assertActive();
      const next = fnReadWidgetCollaborativeStateDocument(documentPort.read(), identity);
      const nextCanonical = JSON.stringify(next);
      if (nextCanonical === canonical) return;
      current = next;
      canonical = nextCanonical;
      version += 1;
      settlePending();
    } catch (error) {
      fail(error);
    }
  };

  const unsubscribe = documentPort.subscribe(refresh);

  const admitMutation = () => {
    const now = nowMs();
    if (!Number.isSafeInteger(now) || now < 0 || now < lastNowMs) {
      throw new Error('Widget collaborative state clock is invalid.');
    }
    lastNowMs = now;
    while (
      mutationTimes.length > 0
      && mutationTimes[0]! <= now - MUTATION_RATE_WINDOW_MS
    ) mutationTimes.shift();
    if (mutationTimes.length >= MUTATION_RATE_LIMIT) {
      throw new Error('Widget collaborative state mutation rate limit exceeded.');
    }
    mutationTimes.push(now);
  };

  return Object.freeze({
    identity: Object.freeze({ ...identity }),
    async get() {
      assertActive();
      refresh();
      assertActive();
      return snapshot();
    },
    async change(value: TWidgetCollaborativeJsonValue) {
      assertActive();
      admitMutation();
      const next = fnNormalizeWidgetCollaborativeJson(value);
      documentPort.change((mutableDocument) => {
        fnReadWidgetCollaborativeStateDocument(mutableDocument, identity);
        mutableDocument.state = fnNormalizeWidgetCollaborativeJson(next);
      });
      refresh();
      assertActive();
      return snapshot();
    },
    async next(afterVersion: number, waitId: string) {
      assertActive();
      if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) {
        throw new TypeError('Widget collaborative state version is invalid.');
      }
      if (!WAIT_ID_PATTERN.test(waitId)) {
        throw new TypeError('Widget collaborative state wait id is invalid.');
      }
      refresh();
      assertActive();
      if (version > afterVersion) return snapshot();
      if (pending.size >= MAX_PENDING_STATE_WAITS) {
        throw new Error('Widget collaborative state wait limit exceeded.');
      }
      if (pending.has(waitId)) {
        throw new Error('Widget collaborative state wait id is already pending.');
      }
      return await new Promise<TWidgetCollaborativeStateSnapshot>((resolve, reject) => {
        pending.set(waitId, { resolve, reject });
      });
    },
    cancel(waitId: string) {
      if (!WAIT_ID_PATTERN.test(waitId)) return;
      const waiter = pending.get(waitId);
      if (!waiter) return;
      pending.delete(waitId);
      waiter.reject(new Error('Widget collaborative state wait was cancelled.'));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      documentPort.dispose?.();
      const error = cancelledError();
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    },
  });
}

export function createWidgetCollaborativeStatePort(
  args: TCreateWidgetCollaborativeStatePortArgs,
): TWidgetCollaborativeStatePort {
  return Object.freeze({
    async open(openArgs) {
      const isExactCurrent = () => openArgs.isCurrent()
        && args.isIdentityCurrent(openArgs.identity);
      if (openArgs.signal.aborted || !isExactCurrent()) {
        throw new Error('Widget collaborative state authority is no longer current.');
      }
      const documentPort = await args.openDocument(openArgs);
      if (openArgs.signal.aborted || !isExactCurrent()) {
        documentPort.dispose?.();
        throw new Error('Widget collaborative state authority is no longer current.');
      }
      try {
        const session = createSession(documentPort, openArgs.identity, () => isExactCurrent(), args.nowMs);
        if (!fnWidgetCollaborativeStateIdentitiesMatch(session.identity, openArgs.identity)) {
          session.dispose();
          throw new Error('Widget collaborative state identity mismatch.');
        }
        return session;
      } catch (error) {
        documentPort.dispose?.();
        throw error;
      }
    },
  });
}

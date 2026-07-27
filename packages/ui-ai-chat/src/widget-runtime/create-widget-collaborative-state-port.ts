import {
  fnNormalizeWidgetCollaborativeJson,
  fnNormalizeWidgetCollaborativeStateTransportSnapshot,
  fnWidgetCollaborativeStateIdentitiesMatch,
} from './fn.collaborative-state-json';
import type {
  TWidgetCollaborativeJsonValue,
  TWidgetCollaborativeStateIdentity,
  TWidgetCollaborativeStatePort,
  TWidgetCollaborativeStateSession,
  TWidgetCollaborativeStateSnapshot,
  TWidgetCollaborativeStateTransportPort,
  TWidgetCollaborativeStateTransportSnapshot,
} from './interface';

const MAX_PENDING_STATE_WAITS = 32;
const WAIT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,170}$/;

type TCreateWidgetCollaborativeStatePortArgs = Readonly<{
  openTransport(args: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    signal: AbortSignal;
  }>): TWidgetCollaborativeStateTransportPort;
  isIdentityCurrent(identity: TWidgetCollaborativeStateIdentity): boolean;
}>;

type TPendingWait = Readonly<{
  afterVersion: number;
  resolve(snapshot: TWidgetCollaborativeStateSnapshot): void;
  reject(error: Error): void;
}>;

export class WidgetCollaborativeStateConflictError extends Error {
  readonly snapshot: TWidgetCollaborativeStateSnapshot;

  constructor(snapshot: TWidgetCollaborativeStateSnapshot) {
    super('Widget collaborative state changed before this mutation was committed.');
    this.name = 'WidgetCollaborativeStateConflictError';
    this.snapshot = snapshot;
  }
}

function cancelledError(): Error {
  return new Error('Widget collaborative state session is disposed.');
}

function canonicalState(
  snapshot: TWidgetCollaborativeStateTransportSnapshot,
): string {
  return JSON.stringify(snapshot.state);
}

async function createSession(
  transport: TWidgetCollaborativeStateTransportPort,
  identity: TWidgetCollaborativeStateIdentity,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<TWidgetCollaborativeStateSession> {
  let disposed = false;
  let failure: Error | null = null;
  let current = fnNormalizeWidgetCollaborativeStateTransportSnapshot(
    await transport.get({ identity, signal }),
    identity,
  );
  let canonical = canonicalState(current);
  const pending = new Map<string, TPendingWait>();
  let eventIterator: AsyncIterator<TWidgetCollaborativeStateTransportSnapshot> | null = null;
  let mutationOperation: Promise<void> = Promise.resolve();

  const assertActive = (): void => {
    if (disposed) throw cancelledError();
    if (failure) throw failure;
    if (!isCurrent()) {
      throw new Error('Widget collaborative state authority is no longer current.');
    }
  };

  const snapshot = (): TWidgetCollaborativeStateSnapshot => Object.freeze({
    version: current.version,
    value: fnNormalizeWidgetCollaborativeJson(current.state),
  });

  const settlePending = (): void => {
    if (pending.size === 0) return;
    const next = snapshot();
    for (const [waitId, waiter] of pending) {
      if (next.version <= waiter.afterVersion) continue;
      pending.delete(waitId);
      waiter.resolve(next);
    }
  };

  const fail = (error: unknown): void => {
    if (failure || disposed) return;
    failure = error instanceof Error
      ? error
      : new Error('Widget collaborative state became unavailable.');
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
  };

  const accept = (
    candidate: TWidgetCollaborativeStateTransportSnapshot,
  ): void => {
    const next = fnNormalizeWidgetCollaborativeStateTransportSnapshot(
      candidate,
      identity,
    );
    const nextCanonical = canonicalState(next);
    if (next.version < current.version) return;
    if (next.version === current.version) {
      if (nextCanonical !== canonical) {
        throw new Error('Widget collaborative state changed without advancing its durable version.');
      }
      return;
    }
    current = next;
    canonical = nextCanonical;
    settlePending();
  };

  assertActive();
  const events = await transport.events({
    identity,
    afterVersion: current.version,
    signal,
  });
  assertActive();
  eventIterator = events[Symbol.asyncIterator]();

  const consumeEvents = async (): Promise<void> => {
    try {
      while (!disposed) {
        const result = await eventIterator!.next();
        if (result.done) {
          if (!disposed) {
            throw new Error('Widget collaborative state event stream ended.');
          }
          return;
        }
        assertActive();
        accept(result.value);
      }
    } catch (error) {
      fail(error);
    }
  };
  void consumeEvents();

  const session = Object.freeze({
    identity: Object.freeze({ ...identity }),
    async get(): Promise<TWidgetCollaborativeStateSnapshot> {
      assertActive();
      accept(await transport.get({ identity, signal }));
      assertActive();
      return snapshot();
    },
    async change(
      value: TWidgetCollaborativeJsonValue,
    ): Promise<TWidgetCollaborativeStateSnapshot> {
      assertActive();
      const state = fnNormalizeWidgetCollaborativeJson(value);
      const operation = mutationOperation.then(async () => {
        assertActive();
        const expectedVersion = current.version;
        const result = await transport.change({
          identity,
          expectedVersion,
          state,
          signal,
        });
        assertActive();
        if (
          result.status === 'changed'
          && result.snapshot.version !== expectedVersion + 1
        ) {
          throw new Error('Widget collaborative state transport returned an invalid changed version.');
        }
        accept(result.snapshot);
        const next = snapshot();
        if (result.status === 'conflict') {
          throw new WidgetCollaborativeStateConflictError(next);
        }
        return next;
      });
      mutationOperation = operation.then(
        () => undefined,
        () => undefined,
      );
      return await operation;
    },
    async next(
      afterVersion: number,
      waitId: string,
    ): Promise<TWidgetCollaborativeStateSnapshot> {
      assertActive();
      if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) {
        throw new TypeError('Widget collaborative state version is invalid.');
      }
      if (!WAIT_ID_PATTERN.test(waitId)) {
        throw new TypeError('Widget collaborative state wait id is invalid.');
      }
      if (current.version > afterVersion) return snapshot();
      if (pending.size >= MAX_PENDING_STATE_WAITS) {
        throw new Error('Widget collaborative state wait limit exceeded.');
      }
      if (pending.has(waitId)) {
        throw new Error('Widget collaborative state wait id is already pending.');
      }
      return await new Promise<TWidgetCollaborativeStateSnapshot>((resolve, reject) => {
        pending.set(waitId, { afterVersion, resolve, reject });
      });
    },
    cancel(waitId: string): void {
      if (!WAIT_ID_PATTERN.test(waitId)) return;
      const waiter = pending.get(waitId);
      if (!waiter) return;
      pending.delete(waitId);
      waiter.reject(new Error('Widget collaborative state wait was cancelled.'));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const iterator = eventIterator;
      eventIterator = null;
      void iterator?.return?.().catch(() => undefined);
      transport.dispose?.();
      const error = cancelledError();
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    },
  }) satisfies TWidgetCollaborativeStateSession;
  return session;
}

export function createWidgetCollaborativeStatePort(
  args: TCreateWidgetCollaborativeStatePortArgs,
): TWidgetCollaborativeStatePort {
  return Object.freeze({
    async open(openArgs) {
      const isExactCurrent = () => !openArgs.signal.aborted
        && openArgs.isCurrent()
        && args.isIdentityCurrent(openArgs.identity);
      if (openArgs.signal.aborted || !isExactCurrent()) {
        throw new Error('Widget collaborative state authority is no longer current.');
      }
      const transport = args.openTransport(openArgs);
      if (openArgs.signal.aborted || !isExactCurrent()) {
        transport.dispose?.();
        throw new Error('Widget collaborative state authority is no longer current.');
      }
      try {
        const session = await createSession(
          transport,
          openArgs.identity,
          openArgs.signal,
          isExactCurrent,
        );
        if (openArgs.signal.aborted || !isExactCurrent()) {
          session.dispose();
          throw new Error('Widget collaborative state authority is no longer current.');
        }
        if (!fnWidgetCollaborativeStateIdentitiesMatch(
          session.identity,
          openArgs.identity,
        )) {
          session.dispose();
          throw new Error('Widget collaborative state identity mismatch.');
        }
        return session;
      } catch (error) {
        transport.dispose?.();
        throw error;
      }
    },
  });
}

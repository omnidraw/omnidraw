import { fnNormalizeWidgetCollaborativeJson } from '../widget-runtime/fn.collaborative-state-json';
import type {
  TWidgetCollaborativeJsonValue,
  TWidgetCollaborativeStateBridge,
  TWidgetCollaborativeStateSnapshot,
} from '../widget-runtime/interface';

const MAX_PENDING_WAITS = 32;
const WAIT_ID_PATTERN = /^[A-Za-z0-9._~:+-]{1,170}$/;

type TPendingWait = Readonly<{
  leaseId: number;
  resolve(snapshot: TWidgetCollaborativeStateSnapshot): void;
  reject(error: Error): void;
}>;

export type TEphemeralPreviewStateOwner = Readonly<{
  open(): TWidgetCollaborativeStateBridge;
  dispose(): void;
}>;

export function createEphemeralPreviewStateOwner(): TEphemeralPreviewStateOwner {
  let disposed = false;
  let version = 1;
  let value: TWidgetCollaborativeJsonValue = null;
  let nextLeaseId = 1;
  const pending = new Map<string, TPendingWait>();

  const assertOwnerActive = (): void => {
    if (disposed) throw new Error('Preview collaborative state is disposed.');
  };
  const snapshot = (): TWidgetCollaborativeStateSnapshot => Object.freeze({
    version,
    value: fnNormalizeWidgetCollaborativeJson(value),
  });
  const settlePending = (): void => {
    const next = snapshot();
    pending.forEach(({ resolve }) => resolve(next));
    pending.clear();
  };

  return Object.freeze({
    open(): TWidgetCollaborativeStateBridge {
      assertOwnerActive();
      const leaseId = nextLeaseId;
      nextLeaseId += 1;
      let leaseDisposed = false;
      const assertActive = (): void => {
        assertOwnerActive();
        if (leaseDisposed) {
          throw new Error('Preview collaborative-state lease is disposed.');
        }
      };
      return Object.freeze({
        async get() {
          assertActive();
          return snapshot();
        },
        async change(nextValue) {
          assertActive();
          value = fnNormalizeWidgetCollaborativeJson(nextValue);
          version += 1;
          settlePending();
          return snapshot();
        },
        async next(afterVersion, waitId) {
          assertActive();
          if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) {
            throw new TypeError('Preview collaborative-state version is invalid.');
          }
          if (!WAIT_ID_PATTERN.test(waitId)) {
            throw new TypeError('Preview collaborative-state wait id is invalid.');
          }
          if (version > afterVersion) return snapshot();
          if (pending.has(waitId)) {
            throw new Error('Preview collaborative-state wait id is already pending.');
          }
          if (pending.size >= MAX_PENDING_WAITS) {
            throw new Error('Preview collaborative-state wait limit exceeded.');
          }
          return await new Promise<TWidgetCollaborativeStateSnapshot>((resolve, reject) => {
            pending.set(waitId, { leaseId, resolve, reject });
          });
        },
        cancel(waitId) {
          const waiter = pending.get(waitId);
          if (!waiter || waiter.leaseId !== leaseId) return;
          pending.delete(waitId);
          waiter.reject(new Error('Preview collaborative-state wait was cancelled.'));
        },
        dispose() {
          if (leaseDisposed) return;
          leaseDisposed = true;
          const error = new Error('Preview collaborative-state lease is disposed.');
          for (const [waitId, waiter] of pending) {
            if (waiter.leaseId !== leaseId) continue;
            pending.delete(waitId);
            waiter.reject(error);
          }
        },
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new Error('Preview collaborative state is disposed.');
      pending.forEach(({ reject }) => reject(error));
      pending.clear();
    },
  });
}

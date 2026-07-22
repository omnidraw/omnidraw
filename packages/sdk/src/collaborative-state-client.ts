import type { TVibecanvasJsonValue } from './shared';

export type TCollaborativeStateSnapshot<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> = Readonly<{
  version: number;
  value: TValue;
}>;

export interface ICollaborativeStateTransport {
  get<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(): Promise<TCollaborativeStateSnapshot<TValue>>;
  change<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(
    value: TValue,
  ): Promise<TCollaborativeStateSnapshot<TValue>>;
  next<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(
    afterVersion: number,
    waitId: string,
  ): Promise<TCollaborativeStateSnapshot<TValue>>;
  cancel(waitId: string): void | Promise<void>;
}

export const COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY = '__VIBECANVAS_COLLABORATIVE_STATE_TRANSPORT_V1__' as const;

type TCollaborativeStateGlobal = typeof globalThis & Readonly<Record<
  typeof COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY,
  unknown
>>;

let collaborativeStateTransport: ICollaborativeStateTransport | null = null;
let collaborativeStateSubscriptionSequence = 0;

function nextCollaborativeStateSubscriptionId(): string {
  collaborativeStateSubscriptionSequence += 1;
  if (!Number.isSafeInteger(collaborativeStateSubscriptionSequence)) {
    throw new Error('The widget collaborative-state subscription limit was exceeded.');
  }
  return collaborativeStateSubscriptionSequence.toString(36);
}

function browserHostTransport(): ICollaborativeStateTransport | null {
  const candidate = (globalThis as TCollaborativeStateGlobal)[COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY];
  if (
    candidate === null
    || typeof candidate !== 'object'
    || typeof (candidate as Partial<ICollaborativeStateTransport>).get !== 'function'
    || typeof (candidate as Partial<ICollaborativeStateTransport>).change !== 'function'
    || typeof (candidate as Partial<ICollaborativeStateTransport>).next !== 'function'
    || typeof (candidate as Partial<ICollaborativeStateTransport>).cancel !== 'function'
  ) return null;
  return candidate as ICollaborativeStateTransport;
}

function transport(): ICollaborativeStateTransport {
  const target = browserHostTransport() ?? collaborativeStateTransport;
  if (target === null) {
    throw new Error('The widget collaborative-state transport is not connected.');
  }
  return target;
}

function assertSnapshot<TValue extends TVibecanvasJsonValue>(
  snapshot: TCollaborativeStateSnapshot<TValue>,
): TCollaborativeStateSnapshot<TValue> {
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
    throw new Error('The widget collaborative-state transport returned an invalid version.');
  }
  return snapshot;
}

export function __setCollaborativeStateTransport(
  value: ICollaborativeStateTransport | null,
): void {
  collaborativeStateTransport = value;
}

export async function getCollaborativeState<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
>(): Promise<TValue> {
  return assertSnapshot(await transport().get<TValue>()).value;
}

export async function changeCollaborativeState<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
>(value: TValue): Promise<TValue> {
  return assertSnapshot(await transport().change(value)).value as TValue;
}

export function subscribeCollaborativeState<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
>(listener: (value: TValue) => void): () => void {
  if (typeof listener !== 'function') {
    throw new TypeError('A collaborative-state listener is required.');
  }
  const target = transport();
  const subscriptionId = nextCollaborativeStateSubscriptionId();
  let active = true;
  let pendingWaitId: string | null = null;
  let waitSequence = 0;
  void (async () => {
    try {
      let snapshot = assertSnapshot(await target.get<TValue>());
      while (active) {
        listener(snapshot.value);
        if (!active) break;
        waitSequence += 1;
        pendingWaitId = `state-wait-${subscriptionId}-${waitSequence.toString(36)}`;
        snapshot = assertSnapshot(await target.next<TValue>(snapshot.version, pendingWaitId));
        pendingWaitId = null;
      }
    } catch {
      // Host teardown rejects a pending long poll. Unsubscribed clients are inert.
      active = false;
    }
  })();
  return () => {
    active = false;
    const waitId = pendingWaitId;
    pendingWaitId = null;
    if (waitId !== null) void Promise.resolve(target.cancel(waitId)).catch(() => undefined);
  };
}

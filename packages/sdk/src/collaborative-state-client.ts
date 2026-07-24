import {
  callCapabilityAsync,
  openCapabilityStream,
  type CapsuleGuestCapabilityStream,
} from '@omnidraw/capsule/guest';
import type {
  TWidgetCapabilityCallOptions,
  TWidgetCapabilitySelector,
} from './function-client';
import type {
  TUnsubscribe,
  TVibecanvasJsonValue,
} from './shared';

export type TCollaborativeStateSnapshot<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
> = Readonly<{
  version: number;
  value: TValue;
}>;

export type TCollaborativeStateSubscriptionOptions = Readonly<{
  signal?: AbortSignal;
  maxEventBytes?: number;
  onError?: (error: unknown) => void;
}>;

export type TCollaborativeStateClient<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
> = Readonly<{
  get(options?: TWidgetCapabilityCallOptions): Promise<TValue>;
  change(
    value: TValue,
    options?: TWidgetCapabilityCallOptions,
  ): Promise<TValue>;
  subscribe(
    listener: (value: TValue) => void,
    options?: TCollaborativeStateSubscriptionOptions,
  ): TUnsubscribe;
  dispose(): void;
}>;

type TAbortListener = EventListenerOrEventListenerObject;

type TAbortRelay = Readonly<{
  signal: AbortSignal;
  abort(): void;
  dispose(): void;
}>;

const COLLABORATIVE_STATE_OPERATIONS = Object.freeze({
  get: 'get',
  change: 'change',
  subscribe: 'subscribe',
});

const COLLABORATIVE_STATE_CAPABILITY = Object.freeze({
  id: 'vibecanvas.widget.collaborative_state',
  versionRange: '1.0.0',
  contractHash:
    'sha256:4f1fb60c04cf513e111bae5840faf4233e47077215a32ceadf58e9d2232b18dc',
}) satisfies TWidgetCapabilitySelector;

function invokeAbortListener(listener: TAbortListener): void {
  if (typeof listener === 'function') {
    listener(Object.freeze({ type: 'abort' }) as Event);
    return;
  }
  listener.handleEvent(Object.freeze({ type: 'abort' }) as Event);
}

/**
 * Capsule's guest VM does not need to expose AbortController for SDK-owned
 * disposal. Its bridge intentionally accepts the small AbortSignal surface
 * implemented here.
 */
function createAbortRelay(source: AbortSignal | undefined): TAbortRelay {
  const listeners = new Set<TAbortListener>();
  let aborted = source?.aborted === true;
  let disposed = false;

  const signal = {
    get aborted(): boolean {
      return aborted;
    },
    addEventListener(type: string, listener: TAbortListener | null): void {
      if (type !== 'abort' || listener === null) return;
      listeners.add(listener);
    },
    removeEventListener(type: string, listener: TAbortListener | null): void {
      if (type !== 'abort' || listener === null) return;
      listeners.delete(listener);
    },
  } as AbortSignal;

  const abort = (): void => {
    if (aborted) return;
    aborted = true;
    for (const listener of [...listeners]) {
      try {
        invokeAbortListener(listener);
      } catch {
        // One abort listener cannot block cancellation of the others.
      }
    }
    listeners.clear();
  };

  const onSourceAbort = (): void => abort();
  if (!aborted) source?.addEventListener('abort', onSourceAbort, { once: true });

  return Object.freeze({
    signal,
    abort,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      source?.removeEventListener('abort', onSourceAbort);
      listeners.clear();
    },
  });
}

function assertSnapshot<TValue extends TVibecanvasJsonValue>(
  value: unknown,
  afterVersion?: number,
): TCollaborativeStateSnapshot<TValue> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || !Object.hasOwn(value, 'version')
    || !Object.hasOwn(value, 'value')
  ) {
    throw new Error('The widget collaborative-state capability returned an invalid snapshot.');
  }
  const snapshot = value as Readonly<Record<string, unknown>>;
  if (
    !Number.isSafeInteger(snapshot.version)
    || (snapshot.version as number) < 1
    || (afterVersion !== undefined && (snapshot.version as number) <= afterVersion)
  ) {
    throw new Error('The widget collaborative-state capability returned an invalid version.');
  }
  return Object.freeze({
    version: snapshot.version as number,
    value: snapshot.value as TValue,
  });
}

function copyCapabilitySelector(
  selector: TWidgetCapabilitySelector,
): TWidgetCapabilitySelector {
  return Object.freeze({
    id: selector.id,
    versionRange: selector.versionRange,
    contractHash: selector.contractHash,
  });
}

export async function getCollaborativeState<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
>(
  options: TWidgetCapabilityCallOptions = {},
): Promise<TValue> {
  const snapshot = assertSnapshot<TValue>(await callCapabilityAsync(
    COLLABORATIVE_STATE_CAPABILITY,
    COLLABORATIVE_STATE_OPERATIONS.get,
    null,
    options,
  ));
  return snapshot.value;
}

export async function changeCollaborativeState<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
>(
  value: TValue,
  options: TWidgetCapabilityCallOptions = {},
): Promise<TValue> {
  const snapshot = assertSnapshot<TValue>(await callCapabilityAsync(
    COLLABORATIVE_STATE_CAPABILITY,
    COLLABORATIVE_STATE_OPERATIONS.change,
    Object.freeze({ value }),
    options,
  ));
  return snapshot.value;
}

function startCollaborativeStateSubscription<
  TValue extends TVibecanvasJsonValue,
>(
  selector: TWidgetCapabilitySelector,
  listener: (value: TValue) => void,
  options: TCollaborativeStateSubscriptionOptions,
  onStopped: () => void,
): TUnsubscribe {
  if (typeof listener !== 'function') {
    throw new TypeError('A collaborative-state listener is required.');
  }
  if (options.signal !== undefined && (
    typeof options.signal !== 'object'
    || typeof options.signal.aborted !== 'boolean'
    || typeof options.signal.addEventListener !== 'function'
    || typeof options.signal.removeEventListener !== 'function'
  )) {
    throw new TypeError('A collaborative-state subscription signal must be an AbortSignal.');
  }
  if (options.signal?.aborted === true) {
    onStopped();
    return () => undefined;
  }

  const stream: CapsuleGuestCapabilityStream = openCapabilityStream(
    selector,
    COLLABORATIVE_STATE_OPERATIONS.subscribe,
    null,
    options.maxEventBytes === undefined
      ? {}
      : { maxEventBytes: options.maxEventBytes },
  );
  let active = true;
  let lastVersion: number | undefined;

  const unsubscribe = (): void => {
    if (!active) return;
    active = false;
    options.signal?.removeEventListener('abort', unsubscribe);
    try {
      stream.cancel();
    } finally {
      onStopped();
    }
  };
  try {
    options.signal?.addEventListener('abort', unsubscribe, { once: true });
  } catch (error) {
    stream.cancel();
    onStopped();
    throw error;
  }

  void (async (): Promise<void> => {
    try {
      while (active) {
        const next = await stream.next();
        if (!active || next.done) break;
        const snapshot = assertSnapshot<TValue>(next.value, lastVersion);
        lastVersion = snapshot.version;
        listener(snapshot.value);
      }
    } catch (error) {
      if (active) {
        try {
          options.onError?.(error);
        } catch {
          // Error observers are isolated from subscription cleanup.
        }
      }
    } finally {
      unsubscribe();
    }
  })();

  return unsubscribe;
}

export function subscribeCollaborativeState<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
>(
  listener: (value: TValue) => void,
  options: TCollaborativeStateSubscriptionOptions = {},
): TUnsubscribe {
  return startCollaborativeStateSubscription(
    COLLABORATIVE_STATE_CAPABILITY,
    listener,
    options,
    () => undefined,
  );
}

/**
 * Creates a lifecycle-owned collaborative-state client. Disposing it cancels
 * every stream and every still-pending get/change call made by that client.
 */
export function createCollaborativeStateClient<
  TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue,
>(): TCollaborativeStateClient<TValue> {
  const capability = COLLABORATIVE_STATE_CAPABILITY;
  const pendingCalls = new Set<TAbortRelay>();
  const subscriptions = new Set<TUnsubscribe>();
  let disposed = false;

  const runCall = async <TResult>(
    operation: 'get' | 'change',
    input: unknown,
    options: TWidgetCapabilityCallOptions,
  ): Promise<TResult> => {
    if (disposed) {
      throw new Error('The widget collaborative-state client is disposed.');
    }
    const relay = createAbortRelay(options.signal);
    pendingCalls.add(relay);
    try {
      return await callCapabilityAsync(
        capability,
        operation,
        input,
        {
          signal: relay.signal,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        },
      ) as TResult;
    } finally {
      pendingCalls.delete(relay);
      relay.dispose();
    }
  };

  return Object.freeze({
    async get(options: TWidgetCapabilityCallOptions = {}): Promise<TValue> {
      return assertSnapshot<TValue>(await runCall(
        COLLABORATIVE_STATE_OPERATIONS.get,
        null,
        options,
      )).value;
    },
    async change(
      value: TValue,
      options: TWidgetCapabilityCallOptions = {},
    ): Promise<TValue> {
      return assertSnapshot<TValue>(await runCall(
        COLLABORATIVE_STATE_OPERATIONS.change,
        Object.freeze({ value }),
        options,
      )).value;
    },
    subscribe(
      listener: (value: TValue) => void,
      options: TCollaborativeStateSubscriptionOptions = {},
    ): TUnsubscribe {
      if (disposed) {
        throw new Error('The widget collaborative-state client is disposed.');
      }
      let unsubscribe: TUnsubscribe = () => undefined;
      const stop = (): void => {
        subscriptions.delete(unsubscribe);
      };
      unsubscribe = startCollaborativeStateSubscription(
        capability,
        listener,
        options,
        stop,
      );
      if (!options.signal?.aborted) subscriptions.add(unsubscribe);
      return unsubscribe;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const relay of [...pendingCalls]) relay.abort();
      for (const unsubscribe of [...subscriptions]) unsubscribe();
      pendingCalls.clear();
      subscriptions.clear();
    },
  });
}

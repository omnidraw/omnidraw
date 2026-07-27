import { mock } from 'bun:test';

type TSelector = Readonly<{
  id: string;
  versionRange: string;
  contractHash: `sha256:${string}`;
}>;

type TCallOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type TFakeCapabilityStream = Readonly<{
  id: string;
  next(): Promise<IteratorResult<unknown>>;
  cancel(): void;
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
}>;

type TSubscription = Readonly<{ unsubscribe(): void }>;
type TValueListener = (value: unknown) => void;
type TLifecycleListener = (value: Readonly<{
  state: 'active' | 'throttled' | 'frozen' | 'parked';
  generation: number;
}>) => void;

function subscription<TListener>(
  listeners: Set<TListener>,
  listener: TListener,
): TSubscription {
  listeners.add(listener);
  let active = true;
  return Object.freeze({
    unsubscribe(): void {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    },
  });
}

const propsListeners = new Set<TValueListener>();
const themeListeners = new Set<TValueListener>();
const lifecycleListeners = new Set<TLifecycleListener>();
const localStore = new Map<string, unknown>();

export const capsuleGuestMock = {
  callCapabilityAsync: async (
    _selector: TSelector,
    _operation: string,
    _input: unknown,
    _options: TCallOptions,
  ): Promise<unknown> => {
    throw new Error('Unexpected fake Capsule capability call.');
  },
  openCapabilityStream: (
    _selector: TSelector,
    _operation: string,
    _input: unknown,
    _options: Readonly<{ maxEventBytes?: number }>,
  ): TFakeCapabilityStream => {
    throw new Error('Unexpected fake Capsule capability stream.');
  },
  props: null as unknown,
  theme: null as unknown,
  outputs: [] as unknown[],
  snapshotHooks: undefined as unknown,
  reset(): void {
    this.callCapabilityAsync = async () => {
      throw new Error('Unexpected fake Capsule capability call.');
    };
    this.openCapabilityStream = () => {
      throw new Error('Unexpected fake Capsule capability stream.');
    };
    this.props = null;
    this.theme = null;
    this.outputs = [];
    this.snapshotHooks = undefined;
    propsListeners.clear();
    themeListeners.clear();
    lifecycleListeners.clear();
    localStore.clear();
  },
  emitProps(value: unknown): void {
    this.props = value;
    for (const listener of [...propsListeners]) listener(value);
  },
  emitTheme(value: unknown): void {
    this.theme = value;
    for (const listener of [...themeListeners]) listener(value);
  },
  emitLifecycle(value: Parameters<TLifecycleListener>[0]): void {
    for (const listener of [...lifecycleListeners]) listener(value);
  },
  listenerCounts(): Readonly<{
    props: number;
    theme: number;
    lifecycle: number;
  }> {
    return Object.freeze({
      props: propsListeners.size,
      theme: themeListeners.size,
      lifecycle: lifecycleListeners.size,
    });
  },
};

mock.module('@omnidraw/capsule/guest', () => ({
  CAPSULE_GUEST_SNAPSHOT_PROTOCOL: 'capsule-guest-snapshot-v1',
  callCapabilityAsync: (
    selector: TSelector,
    operation: string,
    input: unknown,
    options: TCallOptions = {},
  ) => capsuleGuestMock.callCapabilityAsync(selector, operation, input, options),
  openCapabilityStream: (
    selector: TSelector,
    operation: string,
    input: unknown,
    options: Readonly<{ maxEventBytes?: number }> = {},
  ) => capsuleGuestMock.openCapabilityStream(selector, operation, input, options),
  getHostProps: () => capsuleGuestMock.props,
  getHostTheme: () => capsuleGuestMock.theme,
  subscribeHostProps: (listener: TValueListener) => subscription(propsListeners, listener),
  subscribeHostTheme: (listener: TValueListener) => subscription(themeListeners, listener),
  subscribeHostLifecycle: (listener: TLifecycleListener) =>
    subscription(lifecycleListeners, listener),
  emitHostOutput: (value: unknown) => {
    capsuleGuestMock.outputs.push(value);
  },
  getLocalStoreValue: (key: string) => localStore.get(key),
  setLocalStoreValue: (key: string, value: unknown) => {
    localStore.set(key, value);
  },
  deleteLocalStoreValue: (key: string) => localStore.delete(key),
  listLocalStoreKeys: () => Object.freeze([...localStore.keys()].sort()),
  registerSnapshotHooks: (_protocol: string, hooks: unknown) => {
    capsuleGuestMock.snapshotHooks = hooks;
  },
}));

export async function loadWidgetSdk(): Promise<typeof import('../src/widget')> {
  return await import('../src/widget');
}

import {
  CAPSULE_GUEST_SNAPSHOT_PROTOCOL,
  deleteLocalStoreValue,
  emitHostOutput,
  getHostProps,
  getHostTheme,
  getLocalStoreValue,
  listLocalStoreKeys,
  registerSnapshotHooks,
  setLocalStoreValue,
  subscribeHostLifecycle,
  subscribeHostProps,
  subscribeHostTheme,
  type CapsuleGuestSubscription,
} from '@omnidraw/capsule/guest';
import type {
  TWidgetNotificationOutput,
  TWidgetTheme,
  TWidgetLifecycleEvent,
  TWidgetSnapshotHooks,
} from './contracts/types';
import type {
  TUnsubscribe,
  TOmnidrawJsonValue,
} from './shared';

export type {
  TWidgetNotificationOutput,
  TWidgetTheme,
  TWidgetLifecycleEvent,
  TWidgetSnapshotHooks,
} from './contracts/types';

function disposableSubscription(
  subscription: CapsuleGuestSubscription,
): TUnsubscribe {
  let active = true;
  return (): void => {
    if (!active) return;
    active = false;
    subscription.unsubscribe();
  };
}

export function getWidgetProps<
  TProps extends TOmnidrawJsonValue = TOmnidrawJsonValue,
>(): TProps {
  return getHostProps() as TProps;
}

export function subscribeWidgetProps<
  TProps extends TOmnidrawJsonValue = TOmnidrawJsonValue,
>(
  listener: (props: TProps) => void,
): TUnsubscribe {
  return disposableSubscription(subscribeHostProps((value) => {
    listener(value as TProps);
  }));
}

export function getWidgetTheme(): TWidgetTheme {
  return getHostTheme() as TWidgetTheme;
}

export function subscribeWidgetTheme(
  listener: (theme: TWidgetTheme) => void,
): TUnsubscribe {
  return disposableSubscription(subscribeHostTheme((value) => {
    listener(value as TWidgetTheme);
  }));
}

export function subscribeWidgetLifecycle(
  listener: (event: TWidgetLifecycleEvent) => void,
): TUnsubscribe {
  return disposableSubscription(subscribeHostLifecycle((event) => listener(Object.freeze({
    state: event.state,
    generation: event.generation,
  }))));
}

export function emitWidgetOutput(
  output: TWidgetNotificationOutput,
): void {
  emitHostOutput(output);
}

export function getWidgetLocalState<
  TValue extends TOmnidrawJsonValue = TOmnidrawJsonValue,
>(key: string): TValue | undefined {
  return getLocalStoreValue(key) as TValue | undefined;
}

export function setWidgetLocalState<
  TValue extends TOmnidrawJsonValue = TOmnidrawJsonValue,
>(key: string, value: TValue): void {
  setLocalStoreValue(key, value);
}

export function deleteWidgetLocalState(key: string): boolean {
  return deleteLocalStoreValue(key);
}

export function listWidgetLocalStateKeys(): readonly string[] {
  return listLocalStoreKeys();
}

export function registerWidgetSnapshotHooks(
  hooks: TWidgetSnapshotHooks,
): void {
  registerSnapshotHooks(
    CAPSULE_GUEST_SNAPSHOT_PROTOCOL,
    hooks as unknown as Parameters<typeof registerSnapshotHooks>[1],
  );
}

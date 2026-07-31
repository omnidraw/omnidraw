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
  type CapsuleGuestLifecycleEvent,
  type CapsuleGuestSnapshotHooksV1,
  type CapsuleGuestSubscription,
} from '@omnidraw/capsule/guest';
import type {
  TUnsubscribe,
  TOmnidrawJsonValue,
} from './shared';

/** Fixed semantic theme projection exposed by the Omnidraw host. */
export type TWidgetCapsuleTheme = Readonly<{
  format: 'omnidraw.widget-theme.v1';
  appearance: 'light' | 'dark';
  tokens: Readonly<{
    background: string;
    foreground: string;
    surface: string;
    surfaceForeground: string;
    muted: string;
    mutedForeground: string;
    primary: string;
    primaryForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    success: string;
    border: string;
  }>;
}>;

/** The sole bounded first-release guest output action. */
export type TWidgetCapsuleNotificationOutput = Readonly<{
  type: 'notification';
  tone: 'info' | 'success' | 'error';
  message: string;
}>;

export type TWidgetLifecycleEvent = CapsuleGuestLifecycleEvent;
export type TWidgetSnapshotHooks = CapsuleGuestSnapshotHooksV1;

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

export function getWidgetTheme(): TWidgetCapsuleTheme {
  return getHostTheme() as TWidgetCapsuleTheme;
}

export function subscribeWidgetTheme(
  listener: (theme: TWidgetCapsuleTheme) => void,
): TUnsubscribe {
  return disposableSubscription(subscribeHostTheme((value) => {
    listener(value as TWidgetCapsuleTheme);
  }));
}

export function subscribeWidgetLifecycle(
  listener: (event: TWidgetLifecycleEvent) => void,
): TUnsubscribe {
  return disposableSubscription(subscribeHostLifecycle(listener));
}

export function emitWidgetOutput(
  output: TWidgetCapsuleNotificationOutput,
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
  registerSnapshotHooks(CAPSULE_GUEST_SNAPSHOT_PROTOCOL, hooks);
}

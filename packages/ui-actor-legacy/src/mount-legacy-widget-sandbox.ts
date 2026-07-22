import type { TActorEvent } from '@vibecanvas/api/actor/contract';
import type { TLegacyWidgetSandboxMountArgs } from '@vibecanvas/ui-ai-chat';
import {
  mountArrowSandboxBridge,
  type TWidgetRuntimeSnapshot,
} from './mount-arrow-sandbox';
import type { LegacyWidgetActorAdapter } from './LegacyWidgetActorAdapter';
import { fnActorEventSnapshot } from './fn.actor-event-snapshot';

type TPortal = Readonly<{
  adapter: LegacyWidgetActorAdapter;
  args: TLegacyWidgetSandboxMountArgs;
}>;

function actorInstanceIdFromElement(args: TLegacyWidgetSandboxMountArgs): string | null {
  const data = args.element.data;
  return data.type === 'widget' ? data.actorInstanceId ?? null : null;
}

function sleep(portal: TPortal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    portal.args.browser.setTimeout(resolve, ms);
  });
}

async function waitForActorInstanceId(portal: TPortal): Promise<string | null> {
  let delay = 5;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const actorInstanceId = portal.args.getActorInstanceId();
    if (actorInstanceId) return actorInstanceId;
    await sleep(portal, delay);
    delay = Math.min(delay * 2, 250);
  }
  return null;
}

async function initialActorSnapshot(
  portal: TPortal,
  actorInstanceId: string | null,
): Promise<TWidgetRuntimeSnapshot> {
  if (!actorInstanceId) {
    const [elementError, elementSnapshot] = await portal.adapter.getSnapshot({
      elementId: portal.args.element.id,
    });
    if (!elementError) {
      if (elementSnapshot.status === 'created' || elementSnapshot.status === 'starting') {
        portal.args.onLoading();
      } else if (elementSnapshot.error) {
        portal.args.onError(elementSnapshot.error);
      } else {
        portal.args.onRecovered();
      }
      return elementSnapshot;
    }
    const error = {
      phase: 'instance-create' as const,
      code: 'ACTOR_INSTANCE_NOT_READY',
      message: 'Widget actor instance is not ready yet.',
      retryable: true,
    };
    portal.args.onError(error);
    return {
      status: 'error',
      state: 'error',
      context: { message: error.message },
      error,
    };
  }

  const [error, snapshot] = await portal.adapter.getSnapshot({ instanceId: actorInstanceId });
  if (error) {
    const widgetError = {
      phase: 'snapshot' as const,
      code: 'ACTOR_SNAPSHOT_FAILED',
      message: String(error),
      retryable: true,
    };
    portal.args.onError(widgetError);
    return {
      status: 'error',
      state: 'error',
      context: { message: widgetError.message },
      error: widgetError,
    };
  }

  if (snapshot.status === 'created' || snapshot.status === 'starting') {
    portal.args.onLoading();
  } else if (snapshot.error) {
    portal.args.onError(snapshot.error);
  } else if (snapshot.status === 'error' || snapshot.status === 'stopped' || snapshot.status === 'blocked') {
    portal.args.onError({
      phase: 'snapshot',
      code: 'ACTOR_INSTANCE_NOT_READY',
      message: `Widget actor is ${snapshot.status}.`,
      retryable: true,
    });
  } else {
    portal.args.onRecovered();
  }
  return snapshot;
}

export function mountLegacyWidgetSandbox(
  adapter: LegacyWidgetActorAdapter,
  args: TLegacyWidgetSandboxMountArgs,
): () => void {
  const portal: TPortal = { adapter, args };
  let actorInstanceId = args.getActorInstanceId() ?? actorInstanceIdFromElement(args);
  let hasSandboxError = false;
  let unsubscribeActorEvents: (() => void) | undefined;
  let disposed = false;
  let currentSnapshot: TWidgetRuntimeSnapshot | null = null;
  let snapshotHandler: ((snapshot: TWidgetRuntimeSnapshot) => void) | undefined;

  const handleActorEvent = (event: TActorEvent) => {
    const result = fnActorEventSnapshot({ snapshot: currentSnapshot, event });
    if (!result) return;
    if (result.error) args.onError(result.error);
    else if (result.recovered && !hasSandboxError) args.onRecovered();
    currentSnapshot = result.snapshot;
    snapshotHandler?.(result.snapshot);
  };

  const subscribeActorEvents = () => {
    if (unsubscribeActorEvents || disposed || !actorInstanceId || !snapshotHandler) return;
    unsubscribeActorEvents = adapter.subscribe(actorInstanceId, handleActorEvent);
  };

  const ensureActorInstanceId = async (): Promise<string | null> => {
    if (actorInstanceId) return actorInstanceId;
    const nextActorInstanceId = await waitForActorInstanceId(portal);
    if (disposed || !nextActorInstanceId) return null;
    actorInstanceId = nextActorInstanceId;
    subscribeActorEvents();
    return actorInstanceId;
  };

  const cleanupSandbox = mountArrowSandboxBridge({
    root: args.root,
    onError(error) {
      hasSandboxError = true;
      args.onError(error);
    },
  }, {
    sources: args.sandbox.arrowjs,
    bridge: {
      async getSnapshot() {
        const readyActorInstanceId = await ensureActorInstanceId();
        currentSnapshot = await initialActorSnapshot(portal, readyActorInstanceId);
        return currentSnapshot;
      },
      async sendMessage(message) {
        const readyActorInstanceId = await ensureActorInstanceId();
        if (!readyActorInstanceId) {
          return {
            ok: false,
            code: 'ACTOR_INSTANCE_NOT_READY',
            message: 'Widget actor instance is not ready yet.',
          };
        }
        const [error, result] = await adapter.sendMessage({
          instanceId: readyActorInstanceId,
          name: message.name,
          payload: message.payload,
        });
        return error
          ? { ok: false, code: 'ACTOR_SEND_MESSAGE_FAILED', message: String(error) }
          : { ok: true, messageId: result.messageId };
      },
      subscribeSnapshots(handler) {
        snapshotHandler = handler;
        subscribeActorEvents();
        return () => {
          if (snapshotHandler === handler) snapshotHandler = undefined;
          unsubscribeActorEvents?.();
          unsubscribeActorEvents = undefined;
        };
      },
    },
  });

  return () => {
    if (disposed) return;
    disposed = true;
    cleanupSandbox();
    unsubscribeActorEvents?.();
    unsubscribeActorEvents = undefined;
  };
}

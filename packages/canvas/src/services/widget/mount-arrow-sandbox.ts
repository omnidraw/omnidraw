// NOTE: do not rename to tx.* this file is exception as string import code breaks rules
import { html as HTML } from '@arrow-js/core';
import { sandbox as SANDBOX } from '@arrow-js/sandbox';
import SDK_WIDGET_SOURCE from '../../../../sdk/dist/widget.js?raw';
import type { TElement, TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type { TOrpcSafeClient } from '@vibecanvas/orpc-client';
import type { IWidgetConfig } from './interface';
import type { TWidgetActorEvent } from './WidgetManagerService';
import type { TWidgetError } from '@vibecanvas/service-db/model';
import { fnActorEventSnapshot, type TActorSnapshot } from './fn.actor-event-snapshot';

type TWidgetHostActorEventResult =
  | { readonly cursor?: string; readonly type: 'snapshot'; readonly snapshot: TActorSnapshot }
  | { readonly cursor?: string; readonly type: 'noop' };

type TPortal = {
  root: HTMLElement;
  apiService: TOrpcSafeClient;
  subscribeActorInstanceEvents: (actorInstanceId: string, handler: (event: TWidgetActorEvent) => void) => () => void;
  getActorInstanceId: () => string | null;
  onError: (error: TWidgetError) => void;
  onRecovered: () => void;
};

type TArgs = {
  element: TElement;
  sandbox: NonNullable<IWidgetConfig['sandbox']>;
};

type TWidgetActorMessageAction = {
  name: string;
  payload: unknown;
};

function getCursorFromBridgeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  if (!('cursor' in args)) return undefined;
  return typeof args.cursor === 'string' ? args.cursor : undefined;
}

function getActorMessageFromBridgeArgs(args: unknown): TWidgetActorMessageAction | null {
  if (!args || typeof args !== 'object') return null;
  if (!('name' in args) || typeof args.name !== 'string') return null;
  if (!('payload' in args)) return null;

  return {
    name: args.name,
    payload: args.payload,
  };
}

const SDK_MODULE_PATH = '/__vibecanvas_sdk.js';
const SDK_BOOTSTRAP_MODULE_PATH = '/__vibecanvas_sdk_bootstrap.js';
const SDK_HOST_BRIDGE_MODULE = 'host-bridge:vibecanvas-widget';
const SANDBOX_EVENT_COMPAT_SOURCE = `
(() => {
  const noop = () => undefined;
  for (const name of ['preventDefault', 'stopPropagation', 'stopImmediatePropagation', 'reset']) {
    if (name in Object.prototype) continue;
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      value: noop,
    });
  }
})();
`;
const SDK_BOOTSTRAP_SOURCE = `
${SANDBOX_EVENT_COMPAT_SOURCE}
import { __setActorSnapshot, __setSendMessage } from '${SDK_MODULE_PATH}';
import { getActorSnapshot, sendActorMessage, nextActorEvent } from '${SDK_HOST_BRIDGE_MODULE}';

let cursor;

__setSendMessage(async (name, payload) => {
  const result = await sendActorMessage({ name, payload });
  if (!result || result.ok !== true) {
    throw new Error(result?.message || 'Widget actor message failed');
  }
});

void getActorSnapshot().then(__setActorSnapshot);

async function pollActorEvents() {
  while (true) {
    const event = await nextActorEvent({ cursor });
    if (!event || event.type === 'noop') continue;
    cursor = event.cursor ?? cursor;
    if (event.type === 'snapshot') __setActorSnapshot(event.snapshot);
  }
}

void pollActorEvents();

export { actor } from '${SDK_MODULE_PATH}';
`;
const SANDBOX_BASE_CSS = `
:host {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

:host > div {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

*, *::before, *::after {
  box-sizing: border-box;
}
`;

function getSandboxSource(source: Record<string, string | undefined>): Record<string, string> {
  const nextSource: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(source).flatMap(([path, fileSource]) => {
        if (fileSource === undefined) return [];
        const sourceWithSdkBootstrap = fileSource.replaceAll('@vibecanvas/sdk/widget', SDK_BOOTSTRAP_MODULE_PATH);
        const nextFileSource = path === 'main.ts' || path === 'main.js'
          ? `${SANDBOX_EVENT_COMPAT_SOURCE}\n${sourceWithSdkBootstrap}`
          : sourceWithSdkBootstrap;
        return [[path, nextFileSource]];
      }),
    ),
    [SDK_MODULE_PATH]: SDK_WIDGET_SOURCE,
    [SDK_BOOTSTRAP_MODULE_PATH]: SDK_BOOTSTRAP_SOURCE,
  };

  nextSource['main.css'] = `${SANDBOX_BASE_CSS}\n${nextSource['main.css'] ?? ''}`;

  return nextSource;
}

function getActorInstanceId(element: TElement): string | null {
  const data = element.data;
  if (data.type !== 'widget') return null;
  return (data as TWidgetData).actorInstanceId ?? null;
}

function preventDefault(event: Event) {
  event.preventDefault();
}

function bindSandboxFormSubmitGuards(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  const sandboxHosts = Array.from(root.querySelectorAll('arrow-sandbox'));

  for (const sandboxHost of sandboxHosts) {
    let cleanupSubmitGuard: (() => void) | null = null;

    const bindSubmitGuard = () => {
      cleanupSubmitGuard?.();

      const target = sandboxHost.shadowRoot ?? sandboxHost;
      target.addEventListener('submit', preventDefault, { capture: true });
      cleanupSubmitGuard = () => target.removeEventListener('submit', preventDefault, { capture: true });
    };

    sandboxHost.addEventListener('sandbox-ready', bindSubmitGuard);
    bindSubmitGuard();

    cleanups.push(() => {
      sandboxHost.removeEventListener('sandbox-ready', bindSubmitGuard);
      cleanupSubmitGuard?.();
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function getSandboxOutputError(payload: unknown): string | null {
  if (payload instanceof Error) return payload.message;
  if (!payload || typeof payload !== 'object') return null;
  if ('error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
  }
  if ('type' in payload && (payload as { type?: unknown }).type === 'error' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}

function getSandboxHostError(error: Error | string): TWidgetError {
  const rawMessage = error instanceof Error ? error.message : error;
  const message = rawMessage.split('\n').find((line) => line.trim().length > 0)?.trim() || 'Widget sandbox failed.';
  const isCompileError = error instanceof Error && error.name === 'SandboxCompileError';
  return {
    phase: isCompileError ? 'sandbox-compile' : 'sandbox-runtime',
    code: isCompileError ? 'WIDGET_SANDBOX_MOUNT_FAILED' : 'WIDGET_SANDBOX_RUNTIME_FAILED',
    message,
    retryable: false,
  };
}

function sleep(portal: TPortal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const view = portal.root.ownerDocument.defaultView;
    if (view) {
      view.setTimeout(resolve, ms);
      return;
    }

    setTimeout(resolve, ms);
  });
}

async function waitForActorInstanceId(portal: TPortal): Promise<string | null> {
  let delay = 5;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const actorInstanceId = portal.getActorInstanceId();
    if (actorInstanceId) return actorInstanceId;

    await sleep(portal, delay);
    delay = Math.min(delay * 2, 250);
  }

  return null;
}

async function getInitialActorSnapshot(portal: TPortal, actorInstanceId: string | null, elementId: string): Promise<TActorSnapshot> {
  if (!actorInstanceId) {
    const [elementError, elementSnapshot] = await portal.apiService.api.actors.instances.snapshot({ elementId });
    if (!elementError) {
      if (elementSnapshot.error) portal.onError(elementSnapshot.error);
      else portal.onRecovered();
      return elementSnapshot;
    }
    const error: TWidgetError = { phase: 'instance-create', code: 'ACTOR_INSTANCE_NOT_READY', message: 'Widget actor instance is not ready yet.', retryable: true };
    portal.onError(error);
    return { status: 'error', state: 'error', context: { message: error.message }, error };
  }

  const [error, snapshot] = await portal.apiService.api.actors.instances.snapshot({ instanceId: actorInstanceId });
  if (error) {
    const widgetError: TWidgetError = { phase: 'snapshot', code: 'ACTOR_SNAPSHOT_FAILED', message: String(error), retryable: true };
    portal.onError(widgetError);
    return { status: 'error', state: 'error', context: { message: widgetError.message }, error: widgetError };
  }

  if (snapshot.error) {
    portal.onError(snapshot.error);
  } else if (snapshot.status === 'error' || snapshot.status === 'stopped' || snapshot.status === 'blocked') {
    portal.onError({
      phase: 'snapshot',
      code: 'ACTOR_INSTANCE_NOT_READY',
      message: `Widget actor is ${snapshot.status}.`,
      retryable: true,
    });
  } else {
    portal.onRecovered();
  }

  return snapshot;
}

export function mountArrowSandbox(portal: TPortal, args: TArgs) {
  let actorInstanceId = portal.getActorInstanceId() ?? getActorInstanceId(args.element);
  let hasSandboxError = false;
  let unsubscribeActorEvents: (() => void) | undefined;
  let disposed = false;
  let cursor = 0;
  let currentSnapshot: TActorSnapshot | null = null;
  let unbindSandboxFormSubmitGuards: (() => void) | undefined;
  const queuedEvents: TWidgetHostActorEventResult[] = [];
  const pendingResolvers: Array<(event: TWidgetHostActorEventResult) => void> = [];
  const actorPortal: TPortal = {
    ...portal,
    onRecovered: () => {
      if (!hasSandboxError) portal.onRecovered();
    },
  };

  function pushActorEvent(event: TWidgetHostActorEventResult) {
    if (disposed) return;

    const resolve = pendingResolvers.shift();
    if (resolve) {
      resolve(event);
      return;
    }

    queuedEvents.push(event);
  }

  function pushSnapshot(snapshot: TActorSnapshot) {
    currentSnapshot = snapshot;
    cursor += 1;
    pushActorEvent({ type: 'snapshot', cursor: String(cursor), snapshot });
  }

  function handleActorEvent(event: TWidgetActorEvent) {
    const result = fnActorEventSnapshot({ snapshot: currentSnapshot, event });
    if (!result) return;
    if (result.error) actorPortal.onError(result.error);
    else if (result.recovered) actorPortal.onRecovered();
    pushSnapshot(result.snapshot);
  }

  function subscribeActorEvents(nextActorInstanceId: string) {
    if (unsubscribeActorEvents || disposed) return;
    actorInstanceId = nextActorInstanceId;
    unsubscribeActorEvents = portal.subscribeActorInstanceEvents(nextActorInstanceId, handleActorEvent);
  }

  async function ensureActorInstanceId(): Promise<string | null> {
    if (actorInstanceId) {
      subscribeActorEvents(actorInstanceId);
      return actorInstanceId;
    }

    const nextActorInstanceId = await waitForActorInstanceId(portal);
    if (!nextActorInstanceId) return null;
    subscribeActorEvents(nextActorInstanceId);
    return nextActorInstanceId;
  }

  if (actorInstanceId) {
    subscribeActorEvents(actorInstanceId);
  }

  HTML`<section class="vc-widget-sandbox-shell">
    <style>
      .vc-widget-sandbox-shell,
      .vc-widget-sandbox-shell > arrow-sandbox {
        display: block;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
    </style>
    ${SANDBOX({
    source: getSandboxSource(args.sandbox.arrowjs),
    onError(error) {
      hasSandboxError = true;
      portal.onError(getSandboxHostError(error));
    },
  }, {
    output(payload) {
      const message = getSandboxOutputError(payload);
      if (!message) return;
      hasSandboxError = true;
      portal.onError({
        phase: 'sandbox-runtime',
        code: 'WIDGET_SANDBOX_RUNTIME_FAILED',
        message,
        retryable: false,
      });
    },
  }, {
    [SDK_HOST_BRIDGE_MODULE]: {
      async getActorSnapshot() {
        const readyActorInstanceId = await ensureActorInstanceId();
        currentSnapshot = await getInitialActorSnapshot(actorPortal, readyActorInstanceId, args.element.id);
        return currentSnapshot;
      },
      async sendActorMessage(args: unknown) {
        const message = getActorMessageFromBridgeArgs(args);
        if (!message) {
          return {
            ok: false,
            code: 'INVALID_WIDGET_MESSAGE',
            message: 'Widget actor message must be { name: string, payload: unknown }',
          };
        }

        const readyActorInstanceId = await ensureActorInstanceId();
        if (!readyActorInstanceId) {
          return {
            ok: false,
            code: 'ACTOR_INSTANCE_NOT_READY',
            message: 'Widget actor instance is not ready yet.',
          };
        }

        const [error, result] = await portal.apiService.api.actors.instances.sendMessage({
          instanceId: readyActorInstanceId,
          name: message.name,
          payload: message.payload,
        });

        if (error) {
          return {
            ok: false,
            code: 'ACTOR_SEND_MESSAGE_FAILED',
            message: String(error),
          };
        }

        return { ok: true, messageId: result.messageId };
      },
      nextActorEvent(args: unknown) {
        if (disposed) return { type: 'noop', cursor: String(cursor) };

        const requestedCursor = getCursorFromBridgeArgs(args);
        const queuedEvent = queuedEvents.shift();
        if (queuedEvent && queuedEvent.cursor !== requestedCursor) return queuedEvent;
        if (queuedEvent) queuedEvents.unshift(queuedEvent);

        return new Promise<TWidgetHostActorEventResult>((resolve) => {
          pendingResolvers.push(resolve);
        });
      },
    },
  })}
  </section>`(portal.root);

  unbindSandboxFormSubmitGuards = bindSandboxFormSubmitGuards(portal.root);

  return () => {
    disposed = true;
    unbindSandboxFormSubmitGuards?.();
    unsubscribeActorEvents?.();

    while (pendingResolvers.length > 0) {
      pendingResolvers.shift()?.({ type: 'noop', cursor: String(cursor) });
    }

    queuedEvents.length = 0;
  };
}

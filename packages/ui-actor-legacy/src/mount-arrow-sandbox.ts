// NOTE: do not rename to tx.* this file is exception as string import code breaks rules
import { html as HTML } from '@arrow-js/core';
import { sandbox as SANDBOX } from '@arrow-js/sandbox';
import SDK_WIDGET_SOURCE from '../../sdk/dist/widget.js?raw';
import type { TActorStatus, TWidgetError } from '@vibecanvas/service-db/model';
import { WIDGET_SANDBOX_TRUSTED_HOST_LAYOUT_CSS } from '@vibecanvas/ui-ai-chat/widget-runtime';
import {
  fnEnqueueLatestWidgetRuntimeSnapshot,
  type TWidgetRuntimeHostEvent,
} from './fn.widget-runtime-event-queue';

export type TWidgetRuntimeSnapshot = {
  status: TActorStatus;
  state: string;
  context: unknown;
  error?: TWidgetError | null;
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

  nextSource['main.css'] = `${WIDGET_SANDBOX_TRUSTED_HOST_LAYOUT_CSS}${nextSource['main.css'] ?? ''}`;

  return nextSource;
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

export type TArrowSandboxBridge = {
  getSnapshot: () => Promise<TWidgetRuntimeSnapshot>;
  sendMessage: (message: TWidgetActorMessageAction) => Promise<
    | { ok: true; messageId?: string }
    | { ok: false; code: string; message: string }
  >;
  subscribeSnapshots: (handler: (snapshot: TWidgetRuntimeSnapshot) => void) => () => void;
};

type TArrowSandboxBridgePortal = {
  root: HTMLElement;
  onError: (error: TWidgetError) => void;
};

type TArrowSandboxBridgeArgs = {
  sources: Record<string, string | undefined>;
  bridge: TArrowSandboxBridge;
};

/**
 * Mounts the compatibility-only Arrow sandbox and actor SDK bootstrap.
 */
export function mountArrowSandboxBridge(portal: TArrowSandboxBridgePortal, args: TArrowSandboxBridgeArgs) {
  let disposed = false;
  let cursor = 0;
  let currentSnapshot: TWidgetRuntimeSnapshot | null = null;
  let unbindSandboxFormSubmitGuards: (() => void) | undefined;
  let queuedEvents: TWidgetRuntimeHostEvent[] = [];
  const pendingResolvers: Array<(event: TWidgetRuntimeHostEvent) => void> = [];

  const pushActorEvent = (event: TWidgetRuntimeHostEvent) => {
    if (disposed) return;

    const resolve = pendingResolvers.shift();
    if (resolve) {
      resolve(event);
      return;
    }

    queuedEvents = fnEnqueueLatestWidgetRuntimeSnapshot(queuedEvents, event);
  };

  const pushSnapshot = (snapshot: TWidgetRuntimeSnapshot) => {
    currentSnapshot = snapshot;
    cursor += 1;
    pushActorEvent({ type: 'snapshot', cursor: String(cursor), snapshot });
  };

  const unsubscribeSnapshots = args.bridge.subscribeSnapshots(pushSnapshot);

  const disposeBridge = () => {
    if (disposed) return;
    disposed = true;
    try {
      unbindSandboxFormSubmitGuards?.();
    } finally {
      try {
        unsubscribeSnapshots();
      } finally {
        while (pendingResolvers.length > 0) {
          pendingResolvers.shift()?.({ type: 'noop', cursor: String(cursor) });
        }

        queuedEvents.length = 0;
      }
    }
  };

  try {
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
    source: getSandboxSource(args.sources),
    onError(error) {
      disposeBridge();
      portal.onError(getSandboxHostError(error));
    },
  }, {
    output(payload) {
      const message = getSandboxOutputError(payload);
      if (!message) return;
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
        currentSnapshot = await args.bridge.getSnapshot();
        return currentSnapshot;
      },
      async sendActorMessage(value: unknown) {
        const message = getActorMessageFromBridgeArgs(value);
        if (!message) {
          return {
            ok: false,
            code: 'INVALID_WIDGET_MESSAGE',
            message: 'Widget actor message must be { name: string, payload: unknown }',
          };
        }

        return args.bridge.sendMessage(message);
      },
      nextActorEvent(value: unknown) {
        if (disposed) return { type: 'noop', cursor: String(cursor) };

        const requestedCursor = getCursorFromBridgeArgs(value);
        const queuedEvent = queuedEvents.shift();
        if (queuedEvent && queuedEvent.cursor !== requestedCursor) return queuedEvent;
        if (queuedEvent) queuedEvents.unshift(queuedEvent);

        return new Promise<TWidgetRuntimeHostEvent>((resolve) => {
          pendingResolvers.push(resolve);
        });
      },
    },
  })}
    </section>`(portal.root);

    unbindSandboxFormSubmitGuards = bindSandboxFormSubmitGuards(portal.root);
  } catch (error) {
    try {
      disposeBridge();
    } catch {
      // Preserve the mount error after best-effort bridge cleanup.
    }
    portal.root.replaceChildren();
    throw error;
  }

  return disposeBridge;
}

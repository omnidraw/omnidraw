// NOTE: do not rename to tx.* this file is exception as string import code breaks rules
import { html as HTML } from '@arrow-js/core';
import { sandbox as SANDBOX } from '@arrow-js/sandbox';
import SDK_WIDGET_SOURCE from '../../../../sdk/dist/widget.js?raw';
import type { TElement, TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type { TOrpcSafeClient } from '@vibecanvas/orpc-client';
import type { IWidgetConfig } from './interface';

type TActorSnapshot = {
  state: string;
  context: unknown;
};

type TPortal = {
  root: HTMLElement;
  apiService: TOrpcSafeClient;
};

type TArgs = {
  element: TElement;
  sandbox: NonNullable<IWidgetConfig['sandbox']>;
};

function getCursorFromBridgeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  if (!('cursor' in args)) return undefined;
  return typeof args.cursor === 'string' ? args.cursor : undefined;
}

const SDK_MODULE_PATH = '/__vibecanvas_sdk.js';
const SDK_BOOTSTRAP_MODULE_PATH = '/__vibecanvas_sdk_bootstrap.js';
const SDK_HOST_BRIDGE_MODULE = 'host-bridge:vibecanvas-widget';
const SDK_BOOTSTRAP_SOURCE = `
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
        return [[path, fileSource.replaceAll('@vibecanvas/sdk/widget', SDK_BOOTSTRAP_MODULE_PATH)]];
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

async function getInitialActorSnapshot(portal: TPortal, args: TArgs): Promise<TActorSnapshot> {
  const actorInstanceId = getActorInstanceId(args.element);
  if (!actorInstanceId) return { state: 'booting', context: null };

  const [error, snapshot] = await portal.apiService.api.actors.instances.snapshot({ instanceId: actorInstanceId });
  if (error) return { state: 'error', context: { message: String(error) } };

  return snapshot;
}

export function mountArrowSandbox(portal: TPortal, args: TArgs) {
  let messageIndex = 0;
  let cursor = '0';
  let currentSnapshot: TActorSnapshot | null = null;

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
  }, {
    output(payload) {
      console.log(payload)
    },
  }, {
    [SDK_HOST_BRIDGE_MODULE]: {
      async getActorSnapshot() {
        currentSnapshot = await getInitialActorSnapshot(portal, args);
        return currentSnapshot;
      },
      sendActorMessage() {
        messageIndex += 1;
        return { ok: true, messageId: `mock-widget-message-${messageIndex}` };
      },
      nextActorEvent(args: unknown) {
        const requestedCursor = getCursorFromBridgeArgs(args);
        if (requestedCursor !== cursor && currentSnapshot) {
          return { type: 'snapshot', cursor, snapshot: currentSnapshot };
        }

        return new Promise((resolve) => {
          setTimeout(() => {
            currentSnapshot = {
              state: 'ready',
              context: {
                message: 'mock actor context updated after 3s',
                updatedAt: new Date().toISOString(),
              },
            };
            cursor = String(Number(cursor) + 1);
            resolve({ type: 'snapshot', cursor, snapshot: currentSnapshot });
          }, 3000);
        });
      },
    },
  })}
  </section>`(portal.root);
}

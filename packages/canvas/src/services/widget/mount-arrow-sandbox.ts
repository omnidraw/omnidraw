import { html as HTML } from '@arrow-js/core';
import { sandbox as SANDBOX } from '@arrow-js/sandbox';
import SDK_WIDGET_SOURCE from '../../../../sdk/dist/widget.js?raw';
import type { IWidgetConfig } from './interface';

type TPortal = {
  root: HTMLElement;
};

type TArgs = {
  sandbox: NonNullable<IWidgetConfig['sandbox']>;
};

type TMockActorSnapshot = {
  state: string;
  context: unknown;
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

export function mountArrowSandbox(portal: TPortal, args: TArgs) {
  let messageIndex = 0;
  let snapshot: TMockActorSnapshot = {
    state: 'booting',
    context: null,
  };
  let cursor = '0';

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
        getActorSnapshot() {
          return snapshot;
        },
        sendActorMessage() {
          messageIndex += 1;
          return { ok: true, messageId: `mock-widget-message-${messageIndex}` };
        },
        nextActorEvent(args: unknown) {
          const requestedCursor = getCursorFromBridgeArgs(args);
          if (requestedCursor !== cursor) {
            return { type: 'snapshot', cursor, snapshot };
          }

          return new Promise((resolve) => {
            setTimeout(() => {
              snapshot = {
                state: 'ready',
                context: {
                  message: 'mock actor context updated after 3s',
                  updatedAt: new Date().toISOString(),
                },
              };
              cursor = String(Number(cursor) + 1);
              resolve({ type: 'snapshot', cursor, snapshot });
            }, 3000);
          });
        },
      },
    })}
  </section>`(portal.root);
}

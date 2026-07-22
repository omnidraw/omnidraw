import { html as HTML } from '@arrow-js/core';
import { sandbox as SANDBOX } from '@arrow-js/sandbox';
import {
  WIDGET_SANDBOX_TRUSTED_HOST_LAYOUT_CSS,
  WIDGET_COLLABORATIVE_STATE_HOST_MODULE,
  WIDGET_COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY,
  WIDGET_SERVER_FUNCTION_HOST_MODULE,
  WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY,
} from './CONSTANTS';
import type {
  TWidgetServerFunctionClientRequest,
  TWidgetUiArtifactMountPort,
} from './interface';

const ARTIFACT_MODULE_PATH = '/__vibecanvas_widget_artifact.js';
const ID_PATTERN = /^[A-Za-z0-9._~:+-]{1,170}$/;
const FUNCTION_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

function serverFunctionRequest(value: unknown): TWidgetServerFunctionClientRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Widget server-function request is invalid.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'functionName'
    || keys[1] !== 'idempotencyKey'
    || keys[2] !== 'input'
    || typeof record.functionName !== 'string'
    || !FUNCTION_NAME_PATTERN.test(record.functionName)
    || typeof record.idempotencyKey !== 'string'
    || record.idempotencyKey.length < 1
    || record.idempotencyKey.length > 200
  ) {
    throw new TypeError('Widget server-function request is invalid.');
  }
  return {
    functionName: record.functionName,
    input: record.input,
    idempotencyKey: record.idempotencyKey,
  };
}

function bootstrapSource(): string {
  return `
import { component, onCleanup } from '@arrow-js/core';
import { createIdempotencyPrefix, invokeServerFunction } from '${WIDGET_SERVER_FUNCTION_HOST_MODULE}';
import { cancelStateWait, changeState, getState, nextState } from '${WIDGET_COLLABORATIVE_STATE_HOST_MODULE}';

const __vibecanvasTransportKey = ${JSON.stringify(WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY)};
const __vibecanvasStateTransportKey = ${JSON.stringify(WIDGET_COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY)};
const __vibecanvasIdempotencyPrefix = await createIdempotencyPrefix();
let __vibecanvasIdempotencyCounter = 0;
let __vibecanvasTransportActive = true;
const __vibecanvasTransport = Object.freeze({
  createIdempotencyKey() {
    if (!__vibecanvasTransportActive) throw new Error('Widget server-function transport is disposed.');
    __vibecanvasIdempotencyCounter += 1;
    return \`\${__vibecanvasIdempotencyPrefix}:\${__vibecanvasIdempotencyCounter}\`;
  },
  invoke(request) {
    if (!__vibecanvasTransportActive) throw new Error('Widget server-function transport is disposed.');
    return invokeServerFunction(request);
  },
});
Object.defineProperty(globalThis, __vibecanvasTransportKey, {
  configurable: false,
  enumerable: false,
  writable: false,
  value: __vibecanvasTransport,
});
const __vibecanvasStateTransport = Object.freeze({
  get() {
    if (!__vibecanvasTransportActive) throw new Error('Widget collaborative-state transport is disposed.');
    return getState();
  },
  change(value) {
    if (!__vibecanvasTransportActive) throw new Error('Widget collaborative-state transport is disposed.');
    return changeState(value);
  },
  next(afterVersion, waitId) {
    if (!__vibecanvasTransportActive) throw new Error('Widget collaborative-state transport is disposed.');
    return nextState(afterVersion, waitId);
  },
  cancel(waitId) {
    if (!__vibecanvasTransportActive) return;
    return cancelStateWait(waitId);
  },
});
Object.defineProperty(globalThis, __vibecanvasStateTransportKey, {
  configurable: false,
  enumerable: false,
  writable: false,
  value: __vibecanvasStateTransport,
});

let __vibecanvasArtifact;
try {
  __vibecanvasArtifact = await import(${JSON.stringify(ARTIFACT_MODULE_PATH)});
} catch (error) {
  __vibecanvasTransportActive = false;
  throw error;
}

const __VibecanvasWidgetRoot = component(() => {
  onCleanup(() => {
    __vibecanvasTransportActive = false;
  });
  return __vibecanvasArtifact.default;
});

export default __VibecanvasWidgetRoot();
`;
}

export const widgetUiArtifactMount: TWidgetUiArtifactMountPort = Object.freeze({
  mount(args) {
    const entry = args.artifact.outputs.find((output) => {
      return output.descriptor.kind === 'entry-point' && output.descriptor.loader === 'js';
    });
    if (!entry?.text) throw new Error('Widget UI artifact entry point is unavailable.');
    const idempotencyPrefix = args.functionBridge.createIdempotencyKey();
    if (!ID_PATTERN.test(idempotencyPrefix)) {
      throw new Error('Widget UI host returned an invalid idempotency prefix.');
    }
    const styles = args.artifact.outputs.flatMap((output) => {
      return output.descriptor.loader === 'css' && output.text !== null ? [output.text] : [];
    }).join('\n');
    let disposed = false;
    let bridgeDisposed = false;
    const disposeBridge = () => {
      if (bridgeDisposed) return;
      bridgeDisposed = true;
      args.functionBridge.dispose();
      args.collaborativeStateBridge?.dispose();
    };

    try {
      HTML`<section class="vc-widget-artifact-shell">
      ${SANDBOX({
        source: {
          'main.js': bootstrapSource(),
          [ARTIFACT_MODULE_PATH]: entry.text,
          'main.css': `${WIDGET_SANDBOX_TRUSTED_HOST_LAYOUT_CSS}${styles}`,
        },
        onError(error) {
          if (disposed) return;
          disposeBridge();
          args.root.dataset.widgetRuntimeStatus = 'error';
          args.root.textContent = error instanceof Error ? error.message : String(error);
          args.onFatal(error);
        },
      }, undefined, {
        [WIDGET_SERVER_FUNCTION_HOST_MODULE]: {
          createIdempotencyPrefix: () => idempotencyPrefix,
          invokeServerFunction: (value: unknown) => {
            if (disposed) throw new Error('Widget server-function bridge is disposed.');
            return args.functionBridge.invoke(serverFunctionRequest(value));
          },
        },
        [WIDGET_COLLABORATIVE_STATE_HOST_MODULE]: {
          getState: () => {
            if (disposed) throw new Error('Widget collaborative-state bridge is disposed.');
            if (!args.collaborativeStateBridge) {
              throw new Error('Widget collaborative state is not configured for this instance.');
            }
            return args.collaborativeStateBridge.get();
          },
          changeState: (value: unknown) => {
            if (disposed) throw new Error('Widget collaborative-state bridge is disposed.');
            if (!args.collaborativeStateBridge) {
              throw new Error('Widget collaborative state is not configured for this instance.');
            }
            return args.collaborativeStateBridge.change(value as never);
          },
          nextState: (afterVersion: unknown, waitId: unknown) => {
            if (disposed) throw new Error('Widget collaborative-state bridge is disposed.');
            if (!args.collaborativeStateBridge) {
              throw new Error('Widget collaborative state is not configured for this instance.');
            }
            if (!Number.isSafeInteger(afterVersion) || (afterVersion as number) < 0) {
              throw new TypeError('Widget collaborative-state version is invalid.');
            }
            if (typeof waitId !== 'string' || !ID_PATTERN.test(waitId)) {
              throw new TypeError('Widget collaborative-state wait id is invalid.');
            }
            return args.collaborativeStateBridge.next(afterVersion as number, waitId);
          },
          cancelStateWait: (waitId: unknown) => {
            if (typeof waitId !== 'string' || !ID_PATTERN.test(waitId)) return;
            args.collaborativeStateBridge?.cancel(waitId);
          },
        },
      })}
      </section>`(args.root);
    } catch (error) {
      disposeBridge();
      args.root.replaceChildren();
      throw error;
    }

    return () => {
      if (disposed) return;
      disposed = true;
      disposeBridge();
      // The fixed guest transport is non-configurable to prevent artifact
      // spoofing. Guest cleanup deactivates it; realm destruction removes it.
      args.root.replaceChildren();
    };
  },
});

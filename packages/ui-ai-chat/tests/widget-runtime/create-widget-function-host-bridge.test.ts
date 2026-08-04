import { describe, expect, test, vi } from 'vitest';
import type { TWidgetBrowserFunctionDescriptor } from '@omnidraw/widget-contract';
import { createWidgetFunctionHostBridge } from '../../src/widget-runtime/create-widget-function-host-bridge';
import type {
  TWidgetRuntimeIdentity,
  TWidgetRuntimeTransportPort,
} from '../../src/widget-runtime/interface';

const identity: TWidgetRuntimeIdentity = Object.freeze({
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  widgetKey: 'counter',
  catalogGeneration: 4,
});

const descriptor: TWidgetBrowserFunctionDescriptor = Object.freeze({
  schemaVersion: 1,
  exportName: 'increment',
  effect: 'tx',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  resources: [{ slot: 'store', effect: 'write' }],
  limits: {
    timeoutMs: 1_000,
    memoryTier: 'small',
    outputByteLimit: 1_024,
    logByteLimit: 1_024,
  },
});

function bridge(invoke: ReturnType<typeof vi.fn>, isTargetCurrent = () => true) {
  return createWidgetFunctionHostBridge({
    identity,
    functionDescriptors: [descriptor],
    isTargetCurrent,
    transport: {
      api: {
        widget: { runtime: { load: vi.fn() } },
        function: { invoke },
      },
    } as unknown as TWidgetRuntimeTransportPort,
  });
}

describe('direct widget function host bridge', () => {
  test('makes one synchronous call with current filesystem identity', async () => {
    const invoke = vi.fn(async () => [undefined, {
      status: 'succeeded',
      output: { count: 2 },
      diagnostics: { code: null, message: null, logByteSize: 0, truncated: false },
    }]);
    const host = bridge(invoke);
    await expect(host.invoke({ functionName: 'increment', input: { amount: 2 } }))
      .resolves.toEqual({ count: 2 });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0]).toEqual({
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
      widgetKey: 'counter',
      catalogGeneration: 4,
      functionName: 'increment',
      input: { amount: 2 },
    });
  });

  test('never retries a write after an unclear transport result', async () => {
    const invoke = vi.fn(async () => [{ code: 'INTERNAL_SERVER_ERROR' }, undefined]);
    await expect(bridge(invoke).invoke({ functionName: 'increment', input: {} }))
      .rejects.toThrow('Widget function execution failed');
    expect(invoke).toHaveBeenCalledOnce();
  });

  test('forwards cancellation and rejects disposed or stale targets', async () => {
    let observedSignal: AbortSignal | undefined;
    const invoke = vi.fn((_input, options: { signal: AbortSignal }) => {
      observedSignal = options.signal;
      return new Promise(() => undefined);
    });
    const host = bridge(invoke);
    const pending = host.invoke({ functionName: 'increment', input: {} });
    await Promise.resolve();
    host.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(observedSignal?.aborted).toBe(true);
    await expect(host.invoke({ functionName: 'increment', input: {} })).rejects.toThrow('disposed');

    await expect(bridge(vi.fn(), () => false).invoke({ functionName: 'increment', input: {} }))
      .rejects.toThrow('no longer current');
  });

  test('rejects undeclared functions and durable Preview execution locally', async () => {
    const invoke = vi.fn();
    await expect(bridge(invoke).invoke({ functionName: 'missing', input: {} }))
      .rejects.toThrow('not declared');
    expect(invoke).not.toHaveBeenCalled();

    const preview = createWidgetFunctionHostBridge({
      identity: { kind: 'draft_preview', draftId: 'draft-a', definitionId: 'old', revision: '1' },
      functionDescriptors: [descriptor],
      isTargetCurrent: () => true,
      transport: {
        api: { widget: { runtime: { load: vi.fn() } }, function: { invoke } },
      } as unknown as TWidgetRuntimeTransportPort,
    });
    await expect(preview.invoke({ functionName: 'increment', input: {} }))
      .rejects.toThrow('live ephemeral Preview runtime');
    expect(invoke).not.toHaveBeenCalled();
  });
});

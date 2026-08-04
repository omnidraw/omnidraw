import type { TWidgetBrowserFunctionDescriptor } from '@omnidraw/widget-contract';
import type {
  TWidgetArtifactRuntimeIdentity,
  TWidgetFunctionHostBridge,
  TWidgetRuntimeIdentity,
  TWidgetRuntimeTransportPort,
  TWidgetServerFunctionClientRequest,
} from './interface';

type TCreateWidgetFunctionHostBridgeArgs = Readonly<{
  identity: TWidgetArtifactRuntimeIdentity;
  transport: TWidgetRuntimeTransportPort;
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
  isTargetCurrent(): boolean;
}>;

type TPendingInvocation = Readonly<{
  cancel(error: Error): void;
}>;

const MAX_IN_FLIGHT_INVOCATIONS = 8;
const MAX_FUNCTION_DESCRIPTORS = 128;
const MAX_FUNCTION_TIMEOUT_MS = 30_000;

function isPublishedIdentity(
  identity: TWidgetArtifactRuntimeIdentity,
): identity is TWidgetRuntimeIdentity {
  return !('kind' in identity);
}

/** One direct transport call. There is no polling, retry, or retained run ID. */
export function createWidgetFunctionHostBridge(
  args: TCreateWidgetFunctionHostBridgeArgs,
): TWidgetFunctionHostBridge {
  if (args.functionDescriptors.length > MAX_FUNCTION_DESCRIPTORS) {
    throw new TypeError('Widget function descriptor policy is invalid.');
  }
  const functions = new Set<string>();
  for (const descriptor of args.functionDescriptors) {
    if (
      !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(descriptor.exportName)
      || functions.has(descriptor.exportName)
      || !Number.isInteger(descriptor.limits.timeoutMs)
      || descriptor.limits.timeoutMs < 1
      || descriptor.limits.timeoutMs > MAX_FUNCTION_TIMEOUT_MS
    ) throw new TypeError('Widget function descriptor policy is invalid.');
    functions.add(descriptor.exportName);
  }

  let disposed = false;
  const pending = new Set<TPendingInvocation>();
  const assertCurrent = () => {
    if (disposed) throw new Error('Widget function host bridge is disposed.');
    if (!args.isTargetCurrent()) {
      throw new Error('Widget function invocation target is no longer current.');
    }
  };

  const run = <TOutput>(
    operation: (signal: AbortSignal) => Promise<TOutput>,
    externalSignal?: AbortSignal,
  ): Promise<TOutput> => new Promise<TOutput>((resolve, reject) => {
    if (pending.size >= MAX_IN_FLIGHT_INVOCATIONS) {
      reject(new Error(
        `Widget function host bridge allows at most ${MAX_IN_FLIGHT_INVOCATIONS} in-flight calls.`,
      ));
      return;
    }
    const controller = new AbortController();
    let settled = false;
    let record!: TPendingInvocation;
    const onExternalAbort = () => record.cancel(
      new Error('Widget function invocation was cancelled.'),
    );
    record = Object.freeze({
      cancel(error: Error) {
        if (settled) return;
        settled = true;
        controller.abort();
        externalSignal?.removeEventListener('abort', onExternalAbort);
        pending.delete(record);
        reject(error);
      },
    });
    if (externalSignal?.aborted === true) {
      record.cancel(new Error('Widget function invocation was cancelled.'));
      return;
    }
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    pending.add(record);
    void operation(controller.signal).then(
      (value) => {
        if (settled) return;
        settled = true;
        controller.abort();
        externalSignal?.removeEventListener('abort', onExternalAbort);
        pending.delete(record);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        controller.abort();
        externalSignal?.removeEventListener('abort', onExternalAbort);
        pending.delete(record);
        reject(error);
      },
    );
  });

  return Object.freeze({
    identity: Object.freeze({ ...args.identity }),
    invoke<TOutput = unknown>(request: TWidgetServerFunctionClientRequest): Promise<TOutput> {
      try {
        assertCurrent();
      } catch (error) {
        return Promise.reject(error);
      }
      if (!functions.has(request.functionName)) {
        return Promise.reject(new Error(
          `Widget function "${request.functionName}" is not declared by this publication.`,
        ));
      }
      const identity = args.identity;
      if (!isPublishedIdentity(identity)) {
        return Promise.reject(new Error(
          'Draft Preview server functions require a live ephemeral Preview runtime.',
        ));
      }
      return run<TOutput>(async (signal) => {
        assertCurrent();
        const [error, result] = await args.transport.api.function.invoke({
          canvasId: identity.canvasId,
          elementId: identity.elementId,
          widgetInstanceId: identity.widgetInstanceId,
          widgetKey: identity.widgetKey,
          catalogGeneration: identity.catalogGeneration,
          functionName: request.functionName,
          input: request.input,
        }, { signal });
        assertCurrent();
        if (error || result === undefined) {
          throw new Error('Widget function execution failed.');
        }
        if (result.status !== 'succeeded') {
          throw new Error(result.failure.message);
        }
        return result.output as TOutput;
      }, request.signal);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new Error('Widget function host bridge is disposed.');
      for (const item of [...pending]) item.cancel(error);
    },
  });
}

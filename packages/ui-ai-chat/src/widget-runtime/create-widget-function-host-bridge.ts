import type { TWidgetBrowserFunctionDescriptor } from '@vibecanvas/widget-contract';
import type {
  TWidgetFunctionHostBridge,
  TWidgetRuntimeIdentity,
  TWidgetRuntimeTransportPort,
  TWidgetServerFunctionClientRequest,
} from './interface';

type TCreateWidgetFunctionHostBridgeArgs = Readonly<{
  identity: TWidgetRuntimeIdentity;
  transport: TWidgetRuntimeTransportPort;
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
  createIdempotencyKey(): string;
  nowMs(): number;
  wait(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  isTargetCurrent(): boolean;
  pollIntervalMs?: number;
  pollSlackMs?: number;
}>;

type TInvocationView = Readonly<{
  id: string;
  functionName: string;
  widgetInstanceId: string;
  widgetRevisionId: string;
  status: string;
  output: unknown;
  failure: null | Readonly<{ message: string }>;
}>;

type TPendingInvocation = Readonly<{
  cancel(error: Error): void;
}>;

type TOperationResult<TValue> =
  | Readonly<{ status: 'fulfilled'; value: TValue }>
  | Readonly<{ status: 'rejected'; error: unknown }>;

const MAX_IN_FLIGHT_INVOCATIONS = 8;
const MAX_PROJECTION_LAG_ATTEMPTS = 6;
const INITIAL_PROJECTION_LAG_BACKOFF_MS = 25;
const MAX_PROJECTION_LAG_BACKOFF_MS = 400;
const MAX_FUNCTION_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_SLACK_MS = 2_000;
const MAX_POLL_SLACK_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 10;
const MAX_FUNCTION_DESCRIPTORS = 128;
const RPC_WATCHDOG_SLICE_MS = 250;
const RPC_WATCHDOG_TICK = Symbol('widget-function-rpc-watchdog-tick');
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+-]{1,200}$/;

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function isProjectionLag(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'WIDGET_INSTANCE_NOT_FOUND' || code === 'NOT_FOUND';
}

function assertInvocationIdentity(
  identity: TWidgetRuntimeIdentity,
  invocation: TInvocationView,
  expected: Readonly<{ functionName: string; invocationId: string }>,
): void {
  if (
    invocation.widgetInstanceId !== identity.widgetInstanceId
    || invocation.widgetRevisionId !== identity.revisionId
    || invocation.functionName !== expected.functionName
    || invocation.id !== expected.invocationId
  ) {
    throw new Error('Widget function invocation identity mismatch.');
  }
}

function observeOperation<TValue>(operation: Promise<TValue>): Readonly<{
  result: Promise<TOperationResult<TValue>>;
  read(): TOperationResult<TValue> | null;
}> {
  let settled: TOperationResult<TValue> | null = null;
  const result = operation.then<TOperationResult<TValue>, TOperationResult<TValue>>(
    (value) => {
      settled = { status: 'fulfilled', value };
      return settled;
    },
    (error: unknown) => {
      settled = { status: 'rejected', error };
      return settled;
    },
  );
  return { result, read: () => settled };
}

function unwrapOperation<TValue>(result: TOperationResult<TValue>): TValue {
  if (result.status === 'rejected') throw result.error;
  return result.value;
}

function pollingBoundError(): Error {
  return new Error('Widget function invocation did not complete within the host polling bound.');
}

function invocationFailure(invocation: TInvocationView): Error {
  return new Error(invocation.failure?.message ?? `Widget function invocation ${invocation.status}.`);
}

export function createWidgetFunctionHostBridge(
  args: TCreateWidgetFunctionHostBridgeArgs,
): TWidgetFunctionHostBridge {
  const pollIntervalMs = args.pollIntervalMs ?? 25;
  const pollSlackMs = args.pollSlackMs ?? DEFAULT_POLL_SLACK_MS;
  if (
    !Number.isInteger(pollIntervalMs)
    || pollIntervalMs < MIN_POLL_INTERVAL_MS
    || pollIntervalMs > 5_000
  ) {
    throw new TypeError('Widget function polling interval is invalid.');
  }
  if (!Number.isInteger(pollSlackMs) || pollSlackMs < 0 || pollSlackMs > MAX_POLL_SLACK_MS) {
    throw new TypeError('Widget function polling slack is invalid.');
  }
  if (args.functionDescriptors.length > MAX_FUNCTION_DESCRIPTORS) {
    throw new TypeError('Widget function descriptor polling policy is invalid.');
  }
  const functionTimeouts = new Map<string, number>();
  for (const descriptor of args.functionDescriptors) {
    const timeoutMs = descriptor.limits.timeoutMs;
    if (
      !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(descriptor.exportName)
      || !Number.isInteger(timeoutMs)
      || timeoutMs < 1
      || timeoutMs > MAX_FUNCTION_TIMEOUT_MS
      || functionTimeouts.has(descriptor.exportName)
    ) {
      throw new TypeError('Widget function descriptor polling policy is invalid.');
    }
    functionTimeouts.set(descriptor.exportName, timeoutMs);
  }
  let disposed = false;
  const pendingInvocations = new Set<TPendingInvocation>();

  const readNowMs = () => {
    const nowMs = args.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error('Widget function host clock is invalid.');
    }
    return nowMs;
  };

  const assertActive = () => {
    if (disposed) throw new Error('Widget function host bridge is disposed.');
  };

  const assertInvocationActive = (signal: AbortSignal) => {
    assertActive();
    if (signal.aborted) throw new Error('Widget function host bridge is disposed.');
    if (!args.isTargetCurrent()) {
      throw new Error('Widget function invocation target is no longer current.');
    }
  };

  const awaitOperationWithinPollingBudget = async <TValue>(
    operation: Promise<TValue>,
    initialRemainingMs: number,
    signal: AbortSignal,
  ): Promise<TValue> => {
    const observed = observeOperation(operation);
    await Promise.resolve();
    const immediate = observed.read();
    if (immediate) return unwrapOperation(immediate);

    let remainingMs = initialRemainingMs;
    while (remainingMs > 0) {
      assertInvocationActive(signal);
      const sliceMs = Math.min(RPC_WATCHDOG_SLICE_MS, remainingMs);
      const watchdogController = new AbortController();
      const abortWatchdog = () => watchdogController.abort();
      signal.addEventListener('abort', abortWatchdog, { once: true });
      let outcome: TOperationResult<TValue> | typeof RPC_WATCHDOG_TICK;
      try {
        outcome = await Promise.race([
          observed.result,
          args.wait(sliceMs, watchdogController.signal).then(
            (): typeof RPC_WATCHDOG_TICK => RPC_WATCHDOG_TICK,
          ),
        ]);
      } finally {
        signal.removeEventListener('abort', abortWatchdog);
        watchdogController.abort();
      }
      if (outcome !== RPC_WATCHDOG_TICK) return unwrapOperation(outcome);
      remainingMs -= sliceMs;
      assertInvocationActive(signal);
    }
    throw pollingBoundError();
  };

  const awaitTerminal = async <TOutput>(
    initial: TInvocationView,
    signal: AbortSignal,
    functionName: string,
    deadlineAtMs: number,
  ): Promise<TOutput> => {
    let invocation = initial;
    const expectedInvocation = Object.freeze({
      functionName,
      invocationId: initial.id,
    });
    let lastObservedNowMs = readNowMs();
    if (lastObservedNowMs > deadlineAtMs) throw pollingBoundError();
    const maxPolls = Math.ceil(
      Math.max(0, deadlineAtMs - lastObservedNowMs) / pollIntervalMs,
    ) + 1;
    for (let poll = 0; poll <= maxPolls; poll += 1) {
      assertInvocationActive(signal);
      const nowMs = readNowMs();
      if (nowMs < lastObservedNowMs) {
        throw new Error('Widget function host clock moved backwards.');
      }
      lastObservedNowMs = nowMs;
      if (poll > 0 && nowMs > deadlineAtMs) break;
      assertInvocationIdentity(args.identity, invocation, expectedInvocation);
      if (invocation.status === 'succeeded') return invocation.output as TOutput;
      if (['failed', 'cancelled', 'timed_out'].includes(invocation.status)) {
        throw invocationFailure(invocation);
      }
      if (poll === maxPolls) break;
      const remainingMs = deadlineAtMs - nowMs;
      if (remainingMs <= 0) break;
      await args.wait(Math.min(pollIntervalMs, remainingMs), signal);
      assertInvocationActive(signal);
      const afterWaitMs = readNowMs();
      if (afterWaitMs < lastObservedNowMs) {
        throw new Error('Widget function host clock moved backwards.');
      }
      lastObservedNowMs = afterWaitMs;
      const [error, next] = await awaitOperationWithinPollingBudget(
        args.transport.api.function.get(
          { invocationId: expectedInvocation.invocationId },
          { signal },
        ),
        Math.max(0, deadlineAtMs - afterWaitMs),
        signal,
      );
      assertInvocationActive(signal);
      if (error || !next) throw new Error('Widget function invocation status is unavailable.');
      invocation = next;
    }
    throw pollingBoundError();
  };

  const runInvocation = <TOutput>(
    operation: (signal: AbortSignal) => Promise<TOutput>,
    externalSignal?: AbortSignal,
  ): Promise<TOutput> => new Promise<TOutput>((resolve, reject) => {
    if (pendingInvocations.size >= MAX_IN_FLIGHT_INVOCATIONS) {
      reject(new Error(
        `Widget function host bridge allows at most ${MAX_IN_FLIGHT_INVOCATIONS} in-flight calls.`,
      ));
      return;
    }

    let settled = false;
    const abortController = new AbortController();
    let record: TPendingInvocation;
    const onExternalAbort = () => record.cancel(
      new Error('Widget function invocation was cancelled.'),
    );
    record = Object.freeze({
      cancel(error) {
        if (settled) return;
        settled = true;
        abortController.abort();
        externalSignal?.removeEventListener('abort', onExternalAbort);
        pendingInvocations.delete(record);
        reject(error);
      },
    });
    if (externalSignal?.aborted === true) {
      record.cancel(new Error('Widget function invocation was cancelled.'));
      return;
    }
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    pendingInvocations.add(record);

    void operation(abortController.signal).then(
      (value) => {
        if (settled) return;
        settled = true;
        abortController.abort();
        externalSignal?.removeEventListener('abort', onExternalAbort);
        pendingInvocations.delete(record);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        abortController.abort();
        externalSignal?.removeEventListener('abort', onExternalAbort);
        pendingInvocations.delete(record);
        reject(error);
      },
    );
  });

  return Object.freeze({
    identity: Object.freeze({ ...args.identity }),
    async invoke<TOutput = unknown>(request: TWidgetServerFunctionClientRequest): Promise<TOutput> {
      assertActive();
      const timeoutMs = functionTimeouts.get(request.functionName);
      if (timeoutMs === undefined) {
        throw new Error(`Widget function "${request.functionName}" is not declared by this revision.`);
      }
      const idempotencyKey = args.createIdempotencyKey();
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new Error('Widget function host returned an invalid idempotency key.');
      }
      return runInvocation<TOutput>(async (signal) => {
        const startedAtMs = readNowMs();
        const deadlineAtMs = startedAtMs + timeoutMs + pollSlackMs;
        if (!Number.isSafeInteger(deadlineAtMs)) {
          throw new Error('Widget function polling deadline is invalid.');
        }
        let lastObservedNowMs = startedAtMs;
        const remainingAdmissionMs = () => {
          assertInvocationActive(signal);
          const nowMs = readNowMs();
          if (nowMs < lastObservedNowMs) {
            throw new Error('Widget function host clock moved backwards.');
          }
          lastObservedNowMs = nowMs;
          const remainingMs = deadlineAtMs - nowMs;
          if (remainingMs <= 0) throw pollingBoundError();
          return remainingMs;
        };
        const invocationRequest = Object.freeze({
          widgetInstanceId: args.identity.widgetInstanceId,
          functionName: request.functionName,
          input: request.input,
          idempotencyKey,
        });
        let delayMs = INITIAL_PROJECTION_LAG_BACKOFF_MS;
        for (let attempt = 1; attempt <= MAX_PROJECTION_LAG_ATTEMPTS; attempt += 1) {
          const admissionBudgetMs = remainingAdmissionMs();
          const [error, invocation] = await awaitOperationWithinPollingBudget(
            args.transport.api.function.invoke(invocationRequest, { signal }),
            admissionBudgetMs,
            signal,
          );
          assertInvocationActive(signal);
          if (!error && invocation) {
            return awaitTerminal<TOutput>(
              invocation,
              signal,
              request.functionName,
              deadlineAtMs,
            );
          }
          if (!isProjectionLag(error) || attempt === MAX_PROJECTION_LAG_ATTEMPTS) {
            throw new Error('Widget function invocation failed.');
          }
          await args.wait(Math.min(delayMs, remainingAdmissionMs()), signal);
          delayMs = Math.min(MAX_PROJECTION_LAG_BACKOFF_MS, delayMs * 2);
        }
        throw new Error('Widget function invocation failed.');
      }, request.signal);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new Error('Widget function host bridge is disposed.');
      for (const pending of [...pendingInvocations]) pending.cancel(error);
    },
  });
}

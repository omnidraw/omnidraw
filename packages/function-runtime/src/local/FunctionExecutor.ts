/**
 * @file One-attempt local executor orchestration around durable leases.
 */

import { randomUUID } from 'node:crypto';
import type { IFunctionControlStore, ISandboxDriver } from '../interface';
import type {
  TAttemptTerminalStatus,
  TFunctionAttempt,
  TFunctionFailure,
  TFunctionInvocationEnvelope,
  TInvocationAttemptCompletionResult,
  TInvocationLease,
  TSandboxExecutionResult,
  TSandboxHandle,
  TUsageMetrics,
} from '../types';
import type { IFunctionSchemaValidator } from './JsonSchemaFunctionValidator';
import type {
  IExactFunctionArtifactReader,
  IInvocationResourceGatewayFactory,
} from './interface';

export type TFunctionExecutorConfig = Readonly<{
  workerId: string;
  store: IFunctionControlStore;
  artifacts: IExactFunctionArtifactReader;
  resources: IInvocationResourceGatewayFactory;
  driver: ISandboxDriver;
  schemas: IFunctionSchemaValidator;
  leaseTtlMs?: number;
  heartbeatMs?: number;
  completionRetryMs?: number;
  nowMs?: () => number;
  createAttemptId?: () => string;
}>;

export type TFunctionExecutionOutcome =
  | Readonly<{ status: 'not_claimed'; reason: string }>
  | Readonly<{
      status: 'completed';
      completion: TInvocationAttemptCompletionResult;
      attempt: TFunctionAttempt;
    }>;

type TTerminal = Readonly<{
  status: Exclude<TAttemptTerminalStatus, 'lost'>;
  output: unknown | null;
  failure: TFunctionFailure | null;
  outputByteSize: number;
  logByteSize: number;
  billable: boolean;
}>;

const ZERO_METRICS: TUsageMetrics = Object.freeze({
  activeWallMs: 0,
  cpuMs: 0,
  allocatedMemoryByteMs: 0,
  peakRssBytes: 0,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
});

function platformFailure(code: string, message: string, retryable = true): TFunctionFailure {
  return { owner: 'platform', code, message, retryable };
}

function cancelledFailure(code = 'FUNCTION_CANCELLED'): TFunctionFailure {
  return {
    owner: 'cancelled',
    code,
    message: code === 'FUNCTION_TIMED_OUT'
      ? 'Function invocation exceeded its deadline.'
      : 'Function invocation was cancelled.',
    retryable: false,
  };
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function terminalFromDriver(result: TSandboxExecutionResult): TTerminal {
  if (result.status === 'succeeded') {
    return {
      status: 'succeeded',
      output: result.output,
      failure: null,
      outputByteSize: result.outputByteSize,
      logByteSize: result.logByteSize,
      billable: true,
    };
  }
  const timedOut = result.failure.code === 'FUNCTION_TIMED_OUT';
  const cancelled = result.failure.code === 'FUNCTION_CANCELLED';
  return {
    status: timedOut ? 'timed_out' : cancelled ? 'cancelled' : 'failed',
    output: null,
    failure: timedOut
      ? cancelledFailure('FUNCTION_TIMED_OUT')
      : cancelled
        ? cancelledFailure()
        : result.failure,
    outputByteSize: result.outputByteSize,
    logByteSize: result.logByteSize,
    billable: result.failure.owner === 'user',
  };
}

function definitionMatchesEnvelope(
  definition: Readonly<{
    orgId: string;
    id: string;
    widgetDefinitionId: string;
    widgetRevisionId: string;
    name: string;
    definitionRevision: number;
    artifactDigestSha256: string;
    contractDigestSha256: string;
    runtimeAbi: string;
  }>,
  envelope: TFunctionInvocationEnvelope,
): boolean {
  return definition.orgId === envelope.tenant.orgId
    && definition.id === envelope.functionId
    && definition.widgetDefinitionId === envelope.widgetDefinitionId
    && definition.widgetRevisionId === envelope.widgetRevisionId
    && definition.name === envelope.functionName
    && definition.definitionRevision === envelope.definitionRevision
    && definition.artifactDigestSha256 === envelope.artifactDigestSha256
    && definition.contractDigestSha256 === envelope.contractDigestSha256
    && definition.runtimeAbi === envelope.runtimeAbi;
}

export class FunctionExecutor {
  readonly #config: TFunctionExecutorConfig;
  readonly #leaseTtlMs: number;
  readonly #heartbeatMs: number;
  readonly #completionRetryMs: number;
  readonly #nowMs: () => number;
  readonly #createAttemptId: () => string;

  constructor(config: TFunctionExecutorConfig) {
    this.#config = config;
    this.#leaseTtlMs = config.leaseTtlMs ?? 5_000;
    this.#heartbeatMs = config.heartbeatMs ?? 500;
    this.#completionRetryMs = config.completionRetryMs ?? 10;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#createAttemptId = config.createAttemptId ?? randomUUID;
  }

  async execute(envelope: TFunctionInvocationEnvelope): Promise<TFunctionExecutionOutcome> {
    const tenant = envelope.tenant;
    const definition = await this.#config.store.resolveFunctionForSubject(tenant, {
      subject: envelope.subject,
      widgetDefinitionId: envelope.widgetDefinitionId,
      widgetRevisionId: envelope.widgetRevisionId,
      functionName: envelope.functionName,
      purpose: 'execution',
    });
    if (!definition || !definitionMatchesEnvelope(definition, envelope)) {
      return { status: 'not_claimed', reason: 'definition_pin_mismatch' };
    }
    const claimed = await this.#config.store.claim(tenant, {
      invocationId: envelope.id,
      attemptId: this.#createAttemptId(),
      workerId: this.#config.workerId,
      sandboxDriver: this.#config.driver.name,
      coldStart: true,
      nowMs: this.#nowMs(),
      ttlMs: this.#leaseTtlMs,
    });
    if (claimed.status !== 'claimed') {
      return { status: 'not_claimed', reason: claimed.reason };
    }

    let attempt = claimed.attempt;
    let lease = claimed.lease;
    let handle: TSandboxHandle | null = null;
    let handleRunning = false;
    let metrics = ZERO_METRICS;
    let terminal: TTerminal | null = null;
    let cancelled = false;
    let monitorBusy = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTask: Promise<void> | null = null;
    let heartbeatFailed = false;

    const inspectCancellation = async (): Promise<void> => {
      if (monitorBusy || terminal !== null) return;
      monitorBusy = true;
      try {
        const record = await this.#config.store.getInvocation(tenant, envelope.id);
        if (record?.cancelRequestedAtMs !== null && record?.cancelRequestedAtMs !== undefined) {
          cancelled = true;
          if (handle) {
            if (handleRunning) await this.#config.driver.cancel(handle, 'invocation cancellation requested');
            else await this.#config.driver.destroy(handle);
          }
        }
      } finally {
        monitorBusy = false;
      }
    };
    const monitor = setInterval(() => { void inspectCancellation(); }, this.#heartbeatMs);
    (monitor as unknown as { unref?: () => void }).unref?.();

    const runHeartbeat = async (): Promise<void> => {
      if (heartbeatTask !== null) return heartbeatTask;
      const task = (async () => {
        if (terminal !== null || heartbeatFailed) return;
        try {
          const measured = handle !== null && handleRunning
            ? await this.#config.driver.measure(handle)
            : metrics;
          metrics = measured;
          const renewed = await this.#config.store.heartbeat(tenant, {
            lease,
            metrics: measured,
            nowMs: this.#nowMs(),
            ttlMs: this.#leaseTtlMs,
          });
          if (renewed.status === 'updated') {
            lease = renewed.lease;
            return;
          }
        } catch {
          // Converted to one durable platform failure below.
        }
        heartbeatFailed = true;
        if (handle !== null) await this.#config.driver.destroy(handle).catch(() => undefined);
      })();
      heartbeatTask = task;
      try {
        await task;
      } finally {
        if (heartbeatTask === task) heartbeatTask = null;
      }
    };

    try {
      await inspectCancellation();
      if (cancelled) {
        terminal = {
          status: 'cancelled', output: null, failure: cancelledFailure(),
          outputByteSize: 0, logByteSize: 0, billable: false,
        };
      }
      if (terminal === null) {
        const input = this.#config.schemas.validate(definition.inputSchema, envelope.input);
        if (!input.valid) {
          terminal = {
            status: 'failed', output: null,
            failure: platformFailure('FUNCTION_INPUT_INTEGRITY', 'Persisted function input failed canonical schema validation.', false),
            outputByteSize: 0, logByteSize: 0, billable: false,
          };
        }
      }
      if (terminal === null) {
        const artifact = await this.#config.artifacts.readExactServerArtifact(tenant, {
          widgetDefinitionId: definition.widgetDefinitionId,
          widgetRevisionId: definition.widgetRevisionId,
          artifactId: definition.serverArtifactId,
          artifactDigestSha256: definition.artifactDigestSha256,
          contractDigestSha256: definition.contractDigestSha256,
          runtimeAbi: definition.runtimeAbi,
          subject: envelope.subject,
        });
        handle = await this.#config.driver.prepare({ definition, artifact });
        await inspectCancellation();
        if (cancelled) {
          await this.#config.driver.destroy(handle);
          terminal = {
            status: 'cancelled', output: null, failure: cancelledFailure(),
            outputByteSize: 0, logByteSize: 0, billable: false,
          };
        }
      }
      if (terminal === null && handle !== null) {
        const started = await this.#config.store.startAttempt(tenant, {
          lease,
          nowMs: this.#nowMs(),
        });
        if (started.status === 'stale') {
          await this.#config.driver.destroy(handle);
          terminal = {
            status: 'failed', output: null,
            failure: platformFailure('FUNCTION_LEASE_STALE', 'Function attempt lease became stale.', true),
            outputByteSize: 0, logByteSize: 0, billable: false,
          };
        } else {
          attempt = started.attempt;
          lease = started.lease;
          // Renew once synchronously, then throughout sandbox startup. Module
          // evaluation may consume most or all of the original claim TTL.
          await runHeartbeat();
          if (heartbeatFailed) {
            terminal = {
              status: 'failed', output: null,
              failure: platformFailure('FUNCTION_LEASE_STALE', 'Function attempt lease became stale.', true),
              outputByteSize: 0, logByteSize: 0, billable: false,
            };
          } else {
            heartbeatTimer = setInterval(() => { void runHeartbeat(); }, this.#heartbeatMs);
            (heartbeatTimer as unknown as { unref?: () => void }).unref?.();
          }
        }
      }
      if (terminal === null && handle !== null) {
        await inspectCancellation();
        if (cancelled) {
          await this.#config.driver.destroy(handle);
          terminal = {
            status: 'cancelled', output: null, failure: cancelledFailure(),
            outputByteSize: 0, logByteSize: 0, billable: false,
          };
        }
      }
      if (terminal === null && handle !== null) {
        // `start` may spawn a child and evaluate top-level guest module bytes.
        // The durable running acknowledgement must therefore precede it.
        handle = await this.#config.driver.start(handle, attempt, {
          deadlineAtMs: envelope.deadlineAtMs,
          observeMetrics: (measured) => { metrics = measured; },
          enterGuestCode: async () => {
            const entered = await this.#config.store.enterGuestCode(tenant, {
              lease,
              nowMs: this.#nowMs(),
            });
            if (entered.status === 'stale') {
              throw Object.assign(new Error('Function attempt lease became stale before guest entry.'), {
                code: 'FUNCTION_LEASE_STALE',
              });
            }
            attempt = entered.attempt;
            lease = entered.lease;
          },
        });
        handleRunning = true;
        await inspectCancellation();
        if (cancelled) {
          await this.#config.driver.cancel(handle, 'invocation cancellation requested');
          terminal = {
            status: 'cancelled', output: null, failure: cancelledFailure(),
            outputByteSize: 0, logByteSize: 0, billable: false,
          };
        }
      }
      if (terminal === null && handle !== null) {
        const resources = await this.#config.resources.createInvocationResourceGateway({
          tenant, definition, envelope, attempt, getLease: () => lease,
        });
        terminal = terminalFromDriver(await this.#config.driver.execute(handle, envelope, resources));
        metrics = await this.#config.driver.measure(handle);
      }
    } catch (error) {
      const timedOut = errorCode(error) === 'FUNCTION_TIMED_OUT';
      terminal = {
        status: cancelled ? 'cancelled' : timedOut ? 'timed_out' : 'failed',
        output: null,
        failure: cancelled
          ? cancelledFailure()
          : timedOut
            ? cancelledFailure('FUNCTION_TIMED_OUT')
          : heartbeatFailed
            ? platformFailure(
                'FUNCTION_LEASE_STALE',
                'Function attempt lease became stale.',
                true,
              )
            : platformFailure(
              'FUNCTION_EXECUTOR_FAILED',
              'Function execution failed inside the platform boundary.',
              true,
            ),
        outputByteSize: 0,
        logByteSize: 0,
        billable: false,
      };
      if (handle) metrics = await this.#config.driver.measure(handle).catch(() => metrics);
    } finally {
      clearInterval(monitor);
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      await (heartbeatTask as Promise<void> | null)?.catch(() => undefined);
      if (handle) {
        try {
          await this.#config.driver.destroy(handle);
        } catch {
          terminal = {
            status: 'failed',
            output: null,
            failure: platformFailure(
              'FUNCTION_SANDBOX_TEARDOWN_FAILED',
              'Function sandbox teardown failed and requires operator attention.',
              true,
            ),
            outputByteSize: 0,
            logByteSize: terminal?.logByteSize ?? 0,
            billable: false,
          };
        }
      }
    }

    terminal ??= {
      status: 'failed', output: null,
      failure: platformFailure('FUNCTION_EXECUTOR_FAILED', 'Function executor produced no terminal result.', true),
      outputByteSize: 0, logByteSize: 0, billable: false,
    };
    if (terminal.status === 'succeeded') {
      const output = this.#config.schemas.validate(definition.outputSchema, terminal.output);
      if (!output.valid) {
        terminal = {
          status: 'failed',
          output: null,
          failure: {
            owner: 'user',
            code: 'FUNCTION_OUTPUT_SCHEMA_INVALID',
            message: 'Function output does not match its canonical schema.',
            retryable: false,
          },
          outputByteSize: 0,
          logByteSize: terminal.logByteSize,
          billable: true,
        };
      }
    }
    const completionRequest = () => ({
      lease,
      status: terminal!.status,
      output: terminal!.output,
      failure: terminal!.failure,
      outputByteSize: terminal!.outputByteSize,
      logByteSize: terminal!.logByteSize,
      metrics,
      billable: terminal!.billable,
      nowMs: this.#nowMs(),
    });
    const maximumCompletionRetries = Math.ceil(this.#leaseTtlMs / this.#completionRetryMs) + 2;
    let completion: TInvocationAttemptCompletionResult | null = null;
    let completionRetries = 0;
    while (completion === null) {
      try {
        completion = await this.#config.store.completeAttempt(tenant, completionRequest());
      } catch {
        if (
          completionRetries >= maximumCompletionRetries
          || this.#nowMs() > envelope.deadlineAtMs + this.#leaseTtlMs
        ) {
          throw new Error('Function completion could not be durably recorded.');
        }
        completionRetries += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, this.#completionRetryMs));
        continue;
      }
      if (completion.status !== 'permit_active') break;
      if (
        completionRetries >= maximumCompletionRetries
        || this.#nowMs() > envelope.deadlineAtMs + this.#leaseTtlMs
      ) break;
      completionRetries += 1;
      await this.#config.store.expireWritePermits(tenant, { nowMs: this.#nowMs(), limit: 100 });
      await new Promise<void>((resolve) => setTimeout(resolve, this.#completionRetryMs));
      completion = null;
    }
    return { status: 'completed', completion, attempt };
  }
}

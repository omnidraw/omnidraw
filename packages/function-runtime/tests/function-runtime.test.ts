import { describe, expect, test } from 'bun:test';
import {
  fnAttemptCanTransition,
  fnFunctionAttemptShouldRetry,
  fnInvocationCanTransition,
  type ISandboxDriver,
  type TFunctionAttempt,
  type TFunctionDefinition,
  type TFunctionInvocationEnvelope,
  type TUsageMetrics,
} from '../src';

const metrics: TUsageMetrics = {
  activeWallMs: 1,
  cpuMs: 1,
  allocatedMemoryByteMs: 1,
  peakRssBytes: 1,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
};

describe('function-runtime public contracts', () => {
  test('defines fenced invocation and attempt transitions', () => {
    expect(fnInvocationCanTransition('queued', 'claimed')).toBe(true);
    expect(fnInvocationCanTransition('queued', 'running')).toBe(false);
    expect(fnInvocationCanTransition('succeeded', 'queued')).toBe(false);
    expect(fnAttemptCanTransition('starting', 'running')).toBe(true);
    expect(fnAttemptCanTransition('lost', 'running')).toBe(false);
  });

  test('retries only platform-owned failures within the attempt bound', () => {
    expect(fnFunctionAttemptShouldRetry({
      status: 'lost',
      failureOwner: 'platform',
      attemptNumber: 1,
      maxAttempts: 2,
    })).toBe(true);
    expect(fnFunctionAttemptShouldRetry({
      status: 'failed',
      failureOwner: 'user',
      attemptNumber: 1,
      maxAttempts: 2,
    })).toBe(false);
  });

  test('supports a fake sandbox driver without storage or actor dependencies', async () => {
    const driver: ISandboxDriver = {
      name: 'fake',
      prepare: async () => ({ driver: 'fake', id: 'prepared' }),
      start: async () => ({ driver: 'fake', id: 'running' }),
      execute: async () => ({
        status: 'succeeded',
        output: { ok: true },
        outputByteSize: 11,
        logByteSize: 0,
      }),
      measure: async () => metrics,
      cancel: async () => undefined,
      reset: async () => undefined,
      destroy: async () => undefined,
    };

    const definition = {} as TFunctionDefinition;
    const attempt = {} as TFunctionAttempt;
    const envelope = {} as TFunctionInvocationEnvelope;
    const prepared = await driver.prepare({ definition, artifact: new Uint8Array() });
    const running = await driver.start(prepared, attempt);
    const result = await driver.execute(running, envelope, {
      call: async () => ({ output: undefined }),
    });

    expect(result.status).toBe('succeeded');
    expect(await driver.measure(running)).toEqual(metrics);
  });
});

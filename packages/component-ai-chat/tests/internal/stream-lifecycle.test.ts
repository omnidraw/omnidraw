import { describe, expect, it, vi } from 'vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { AiChatEffectRuntime, fxPollAiChat } from '../../src/internal/stream-lifecycle.js';

describe('AiChatEffectRuntime', () => {
  it('shares one idempotent disposal completion', async () => {
    const runtime = new AiChatEffectRuntime();
    const disposal = runtime.dispose();
    expect(runtime.dispose()).toBe(disposal);
    await disposal;
    expect(() => runtime.startLatest('retired', {
      run: async () => undefined,
      onSuccess: () => undefined,
      onError: () => undefined,
    })).toThrow('disposed');
  });

  it('polls on the Effect Clock and stops at the first terminal value', async () => {
    let attempts = 0;
    const values: number[] = [];
    const program = fxPollAiChat({
      intervalMs: 1_000,
      run: Effect.sync(() => ++attempts),
      onValue(value) {
        values.push(value);
        return value === 3 ? 'stop' : 'continue';
      },
      onError: (error) => { throw error; },
    });

    await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* program.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(2_000);
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer({ warningDelay: '1 hour' }))));

    expect(values).toEqual([1, 2, 3]);
    expect(attempts).toBe(3);
  });

  it('interrupts a stale keyed action before publishing its completion', async () => {
    const runtime = new AiChatEffectRuntime();
    let staleSignal: AbortSignal | undefined;
    const successes: string[] = [];
    const errors: unknown[] = [];

    runtime.startLatest('connect', {
      run(signal) {
        staleSignal = signal;
        return new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => resolve('stale'), { once: true });
        });
      },
      onSuccess: (value) => successes.push(value),
      onError: (error) => errors.push(error),
    });
    await vi.waitFor(() => expect(staleSignal).toBeDefined());

    runtime.startLatest('connect', {
      run: async () => 'current',
      onSuccess: (value) => successes.push(value),
      onError: (error) => errors.push(error),
    });

    await vi.waitFor(() => expect(successes).toEqual(['current']));
    expect(staleSignal?.aborted).toBe(true);
    expect(errors).toEqual([]);
    await runtime.dispose();
  });

  it('retires every keyed task in a component feature scope', async () => {
    const runtime = new AiChatEffectRuntime();
    const signals: AbortSignal[] = [];
    const successes: string[] = [];
    for (const key of ['settings:login', 'settings:api-key', 'session:history']) {
      runtime.startLatest(key, {
        run(signal) {
          signals.push(signal);
          return new Promise<string>((resolve) => {
            signal.addEventListener('abort', () => resolve(key), { once: true });
          });
        },
        onSuccess: (value) => successes.push(value),
        onError: () => undefined,
      });
    }
    await vi.waitFor(() => expect(signals).toHaveLength(3));

    runtime.closeMatching('settings:');
    await vi.waitFor(() => expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true));
    expect(signals[2]?.aborted).toBe(false);
    expect(successes).toEqual([]);
    await runtime.dispose();
  });

  it('interrupts a keyed poll and suppresses its stale completion', async () => {
    const runtime = new AiChatEffectRuntime();
    let pollSignal: AbortSignal | undefined;
    const values: string[] = [];
    runtime.startPoll('settings:login-poll:test', {
      intervalMs: 1_000,
      run(signal) {
        pollSignal = signal;
        return new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => resolve('stale'), { once: true });
        });
      },
      onValue(value) {
        values.push(value);
        return 'stop';
      },
      onError: () => undefined,
    });
    await vi.waitFor(() => expect(pollSignal).toBeDefined());

    runtime.close('settings:login-poll:test');
    await vi.waitFor(() => expect(pollSignal?.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(values).toEqual([]);
    await runtime.dispose();
  });

  it('does not report stream end or error after abort', async () => {
    const runtime = new AiChatEffectRuntime();
    const ends: string[] = [];
    const errors: unknown[] = [];
    let streamSignal: AbortSignal | undefined;
    const lifecycle = runtime.startStream({
      open(signal) {
        streamSignal = signal;
        return {
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                reject(new Error("Chat prompt operation is already active."));
              }, { once: true });
            });
          },
        };
      },
      onEvent: () => undefined,
      onError: (error) => errors.push(error),
      onEnd: () => ends.push("end"),
    });
    await vi.waitFor(() => expect(streamSignal).toBeDefined());

    lifecycle.close();
    await vi.waitFor(() => expect(streamSignal?.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(errors).toEqual([]);
    expect(ends).toEqual([]);
    await runtime.dispose();
  });

  it('aborts a component-owned action when the runtime is disposed', async () => {
    const runtime = new AiChatEffectRuntime();
    let actionSignal: AbortSignal | undefined;
    const successes: string[] = [];
    runtime.startLatest('session:dispose-test', {
      run(signal) {
        actionSignal = signal;
        return new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => resolve('stale'), { once: true });
        });
      },
      onSuccess: (value) => successes.push(value),
      onError: () => undefined,
    });
    await vi.waitFor(() => expect(actionSignal).toBeDefined());

    await runtime.dispose();
    expect(actionSignal?.aborted).toBe(true);
    expect(successes).toEqual([]);
  });
});

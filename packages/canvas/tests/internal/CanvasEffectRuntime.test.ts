import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { CanvasEffectRuntime } from '../../src/internal/CanvasEffectRuntime';

describe('CanvasEffectRuntime', () => {
  it('opens a new serial generation without abandoning supervision of old work', async () => {
    const runtime = new CanvasEffectRuntime();
    let obsoleteSignal: AbortSignal | undefined;
    const observed: string[] = [];

    runtime.forkSerial(Effect.tryPromise({
      try: (signal) => {
        obsoleteSignal = signal;
        observed.push('obsolete-started');
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', resolve, { once: true });
        });
      },
      catch: (cause) => cause,
    }));
    await vi.waitFor(() => expect(obsoleteSignal).toBeDefined());

    runtime.resetSerial();
    await runtime.runSerial(Effect.sync(() => { observed.push('current-completed'); }));
    expect(observed).toEqual(['obsolete-started', 'current-completed']);

    await runtime.dispose();
    expect(obsoleteSignal?.aborted).toBe(true);
  });
});

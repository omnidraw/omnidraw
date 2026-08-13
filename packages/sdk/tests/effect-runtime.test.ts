import { describe, expect, test } from 'bun:test';
import { SdkEffectRuntime } from '../src/internal/effect-runtime';

describe('SdkEffectRuntime', () => {
  test('shares one idempotent disposal completion', async () => {
    const runtime = new SdkEffectRuntime();
    const disposal = runtime.dispose();
    expect(runtime.dispose()).toBe(disposal);
    await disposal;
    await expect(runtime.run(async () => undefined)).rejects.toThrow('disposed');
  });
});

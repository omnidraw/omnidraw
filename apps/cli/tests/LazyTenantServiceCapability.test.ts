import { describe, expect, test } from 'bun:test';
import { createLazyTenantServiceCapability } from '../src/services/LazyTenantServiceCapability';

describe('createLazyTenantServiceCapability', () => {
  test('does not construct the service until a capability method is called', async () => {
    let resolveCount = 0;
    const capability = createLazyTenantServiceCapability(async () => {
      resolveCount += 1;
      return {
        value: 4,
        add(this: { value: number }, amount: number) {
          return this.value + amount;
        },
      };
    });

    expect(resolveCount).toBe(0);
    expect(await capability.add(3)).toBe(7);
    expect(await capability.add(5)).toBe(9);
    expect(resolveCount).toBe(1);
  });
});

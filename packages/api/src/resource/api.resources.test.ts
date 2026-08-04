import { describe, expect, test } from 'bun:test';
import { ResourceError } from '@omnidraw/resource-runtime';
import { apiRevealResourceSecret } from './api.resources';

describe('resource reveal API', () => {
  test('delegates one bounded secret reveal to the human secret service', async () => {
    const calls: unknown[] = [];
    const reveal = apiRevealResourceSecret.callable({
      context: {
        humanResourceSecret: {
          async revealSecret(input: { resourceId: string; name: string }) {
            calls.push({ input });
            return {
              kind: 'secretStore' as const,
              name: input.name,
              value: 'operator-only-secret',
              revision: 4,
            };
          },
        },
      } as never,
    });

    await expect(reveal({ resourceId: 'secret-resource-1', name: 'api-token' })).resolves.toEqual({
      kind: 'secretStore',
      name: 'api-token',
      value: 'operator-only-secret',
      revision: 4,
    });
    expect(calls).toEqual([{
      input: { resourceId: 'secret-resource-1', name: 'api-token' },
    }]);
  });

  test('rejects an invalid secret name before calling the management service', async () => {
    let called = false;
    const reveal = apiRevealResourceSecret.callable({
      context: {
        humanResourceSecret: {
          async revealSecret() {
            called = true;
            return { kind: 'secretStore' as const, name: 'unused', value: 'unused', revision: 1 };
          },
        },
      } as never,
    });

    await expect(reveal({ resourceId: 'secret-resource-1', name: '   ' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Input validation failed' });
    expect(called).toBe(false);
  });

  test('keeps native failure details and plaintext out of reveal errors', async () => {
    const sentinel = 'must-not-cross-reveal-errors';
    const reveal = apiRevealResourceSecret.callable({
      context: {
        humanResourceSecret: {
          async revealSecret() {
            throw new ResourceError(
              'SECRET_STORE_UNAVAILABLE',
              'Secret-store resource is unavailable.',
              { path: `/secret/${sentinel}`, value: sentinel },
            );
          },
        },
      } as never,
    });

    try {
      await reveal({ resourceId: 'secret-resource-1', name: 'api-token' });
      throw new Error('Expected reveal to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'RESOURCE_ERROR',
        message: 'Secret-store resource is unavailable.',
        data: { code: 'SECRET_STORE_UNAVAILABLE' },
      });
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });
});

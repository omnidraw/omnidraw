import { describe, expect, test } from 'bun:test';
import { ResourceError } from '@omnidraw/resource-runtime';
import { apiRevealResourceSecret } from './api.resources';

const tenant = {
  orgId: 'org-1',
  accountId: 'account-1',
  cellId: 'cell-1',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-1',
} as const;

describe('resource reveal API', () => {
  test('delegates one bounded secret reveal with tenant authority', async () => {
    const calls: unknown[] = [];
    const reveal = apiRevealResourceSecret.callable({
      context: {
        tenant,
        humanResourceSecret: {
          async revealSecret(receivedTenant: unknown, input: { resourceId: string; name: string }) {
            calls.push({ tenant: receivedTenant, input });
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
      tenant,
      input: { resourceId: 'secret-resource-1', name: 'api-token' },
    }]);
  });

  test('rejects an invalid secret name before calling the management service', async () => {
    let called = false;
    const reveal = apiRevealResourceSecret.callable({
      context: {
        tenant,
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

  test('rejects a service principal before the reveal capability is called', async () => {
    let called = false;
    const reveal = apiRevealResourceSecret.callable({
      context: {
        tenant: { ...tenant, roles: ['service'], capabilities: ['*'] },
        humanResourceSecret: {
          async revealSecret() {
            called = true;
            return { kind: 'secretStore' as const, name: 'unused', value: 'unused', revision: 1 };
          },
        },
      } as never,
    });

    await expect(reveal({ resourceId: 'secret-resource-1', name: 'api-token' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(called).toBe(false);
  });

  test('rejects a mixed human and service identity before the reveal capability is called', async () => {
    let called = false;
    const reveal = apiRevealResourceSecret.callable({
      context: {
        tenant: {
          ...tenant,
          roles: ['owner', 'service'],
          capabilities: ['resource:secret:reveal'],
        },
        humanResourceSecret: {
          async revealSecret() {
            called = true;
            return { kind: 'secretStore' as const, name: 'unused', value: 'unused', revision: 1 };
          },
        },
      } as never,
    });

    await expect(reveal({ resourceId: 'secret-resource-1', name: 'api-token' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(called).toBe(false);
  });

  test('requires an explicit reveal capability for a human tenant', async () => {
    let called = false;
    const reveal = apiRevealResourceSecret.callable({
      context: {
        tenant: { ...tenant, capabilities: [] },
        humanResourceSecret: {
          async revealSecret() {
            called = true;
            return { kind: 'secretStore' as const, name: 'unused', value: 'unused', revision: 1 };
          },
        },
      } as never,
    });

    await expect(reveal({ resourceId: 'secret-resource-1', name: 'api-token' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(called).toBe(false);
  });

  test('keeps native failure details and plaintext out of reveal errors', async () => {
    const sentinel = 'must-not-cross-reveal-errors';
    const reveal = apiRevealResourceSecret.callable({
      context: {
        tenant,
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

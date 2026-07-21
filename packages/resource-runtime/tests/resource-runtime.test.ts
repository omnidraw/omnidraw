import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnResourceBindingAllows,
  fnResourceWriteCapabilityMatches,
  type IResourceGateway,
  type TResourceBinding,
  type TResourceRequirement,
} from '../src';

const tenant: TTenantContext = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
};

const requirement: TResourceRequirement = {
  slot: 'preferences',
  kind: 'kv',
  effect: 'read_write',
};

const binding: TResourceBinding = {
  slot: 'preferences',
  resourceId: 'resource-a',
  kind: 'kv',
  allowRead: true,
  allowWrite: false,
};

describe('resource-runtime public contracts', () => {
  test('combines manifest requirements with binding permissions', () => {
    expect(fnResourceBindingAllows(requirement, binding, 'read')).toBe(true);
    expect(fnResourceBindingAllows(requirement, binding, 'write')).toBe(false);
  });

  test('fences decoded write capabilities by tenant, attempt, epoch, and expiry', () => {
    const claims = {
      orgId: 'org-a',
      resourceId: 'resource-a',
      operation: 'set',
      attemptId: 'attempt-a',
      leaseEpoch: 3,
      expiresAtMs: 200,
      nonce: 'nonce-a',
    } as const;

    expect(fnResourceWriteCapabilityMatches(claims, {
      nowMs: 100,
      orgId: 'org-a',
      resourceId: 'resource-a',
      operation: 'set',
      attemptId: 'attempt-a',
      leaseEpoch: 3,
    })).toBe(true);
    expect(fnResourceWriteCapabilityMatches(claims, {
      nowMs: 200,
      orgId: 'org-a',
      resourceId: 'resource-a',
      operation: 'set',
      attemptId: 'attempt-a',
      leaseEpoch: 3,
    })).toBe(false);
  });

  test('supports a fake location-transparent gateway', async () => {
    const gateway: IResourceGateway = {
      call: async (_tenant, call) => ({ output: { operation: call.operation } }),
    };

    expect(await gateway.call(tenant, {
      slot: 'preferences',
      operation: 'get',
      effect: 'read',
      input: { key: 'theme' },
    })).toEqual({ output: { operation: 'get' } });
  });
});

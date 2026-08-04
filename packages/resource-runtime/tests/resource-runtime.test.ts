import { describe, expect, test } from 'bun:test';
import {
  fnResourceBindingDecision,
  fnResourceBindingAllows,
  fnResourceStatusCanTransition,
  fnResourceWriteCapabilityMatches,
  ResourceError,
  toResourceError,
  toSafeResourceError,
  type IResourceGateway,
  type IResourceStore,
  type TResourceBinding,
  type TResourceKind,
  type TResourceRequirement,
} from '../src';

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
    expect(fnResourceBindingDecision(requirement, binding, 'write')).toEqual({
      allowed: false,
      reason: 'binding_denied',
    });
    expect(fnResourceBindingDecision(requirement, {
      ...binding,
      kind: 'db',
    }, 'read')).toEqual({ allowed: false, reason: 'kind_mismatch' });
  });

  test('uses the persisted secretStore spelling as the canonical kind', () => {
    const kinds = ['kv', 'secretStore', 'db'] as const satisfies readonly TResourceKind[];
    expect(kinds).toEqual(['kv', 'secretStore', 'db']);
  });

  test('fences decoded write capabilities by exact call identity and expiry', () => {
    const claims = {
      permitId: 'permit-a',
      resourceId: 'resource-a',
      invocationId: 'invocation-a',
      operation: 'set',
      operationId: 'operation-a',
      operationFingerprintSha256: 'a'.repeat(64),
      expiresAtMs: 200,
      nonce: 'nonce-a',
    } as const;

    expect(fnResourceWriteCapabilityMatches(claims, {
      nowMs: 100,
      resourceId: 'resource-a',
      invocationId: 'invocation-a',
      operation: 'set',
      operationId: 'operation-a',
      operationFingerprintSha256: 'a'.repeat(64),
    })).toBe(true);
    expect(fnResourceWriteCapabilityMatches(claims, {
      nowMs: 200,
      resourceId: 'resource-a',
      invocationId: 'invocation-a',
      operation: 'set',
      operationId: 'operation-a',
      operationFingerprintSha256: 'a'.repeat(64),
    })).toBe(false);
  });

  test('supports a fake location-transparent gateway', async () => {
    const gateway: IResourceGateway = {
      call: async (call) => ({ output: { operation: call.operation } }),
    };

    expect(await gateway.call({
      slot: 'preferences',
      operation: 'get',
      effect: 'read',
      input: { key: 'theme' },
    })).toEqual({ output: { operation: 'get' } });
  });

  test('keeps resolved store calls free of caller-selected paths and handles', async () => {
    const store: IResourceStore = {
      call: async (call) => ({ output: `${call.kind}:${call.resourceId}` }),
      reconcile: async () => undefined,
      close: async () => undefined,
    };

    expect(await store.call({
      slot: 'preferences',
      resourceId: 'resource-a',
      kind: 'kv',
      requirement: { slot: 'preferences', kind: 'kv', effect: 'read' },
      operation: 'get',
      effect: 'read',
      input: { key: 'theme' },
    })).toEqual({ output: 'kv:resource-a' });
  });

  test('defines catalog lifecycle transitions independently of providers', () => {
    expect(fnResourceStatusCanTransition('created', 'provisioning')).toBe(true);
    expect(fnResourceStatusCanTransition('ready', 'migrating')).toBe(true);
    expect(fnResourceStatusCanTransition('migrating', 'ready')).toBe(true);
    expect(fnResourceStatusCanTransition('deleting', 'ready')).toBe(false);
    expect(fnResourceStatusCanTransition('error', 'ready')).toBe(false);
  });

  test('serializes only explicitly safe resource errors', () => {
    const error = new ResourceError('DB_QUERY_FAILED', 'Database query failed.', {
      resourceId: 'resource-a',
      operation: 'inspect',
      sql: 'select private_data',
      nested: {
        count: 2,
        secretValue: 'do-not-leak',
      },
    });

    expect(toSafeResourceError(error)).toEqual({
      code: 'DB_QUERY_FAILED',
      message: 'Database query failed.',
      details: {
        resourceId: 'resource-a',
        operation: 'inspect',
        nested: { count: 2 },
      },
    });
    expect(toSafeResourceError(new Error('raw path /private/data.db'))).toEqual({
      code: 'RESOURCE_PROVIDER_UNAVAILABLE',
      message: 'Resource operation failed.',
    });
  });

  test('normalizes selected control-store conflicts without leaking unknown failures', () => {
    expect(toResourceError(
      { code: 'RESOURCE_NAME_CONFLICT', message: 'Resource name already exists.' },
      'RESOURCE_PROVIDER_UNAVAILABLE',
      'Resource create failed.',
    )).toMatchObject({
      name: 'ResourceError',
      code: 'RESOURCE_NAME_CONFLICT',
      message: 'Resource name already exists.',
    });
    expect(toResourceError(
      new Error('raw database detail'),
      'RESOURCE_PROVIDER_UNAVAILABLE',
      'Resource create failed.',
    )).toMatchObject({
      code: 'RESOURCE_PROVIDER_UNAVAILABLE',
      message: 'Resource create failed.',
    });
  });
});

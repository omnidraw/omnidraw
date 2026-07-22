import { describe, expect, test } from 'bun:test';
import type { TFunctionDefinition, TFunctionInvocationEnvelope } from '@vibecanvas/function-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { FunctionResourceGatewayFactory } from '../src/services/FunctionResourceGatewayFactory';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-a', accountId: 'account-a', cellId: 'cell-a', placementEpoch: 1,
  roles: ['owner'], capabilities: ['*'], requestId: 'request-a',
});

const definition = {
  id: 'function-a',
  widgetDefinitionId: 'definition-a',
  widgetRevisionId: 'revision-a',
  definitionRevision: 1,
  contractDigestSha256: 'b'.repeat(64),
  serverArtifactId: 'artifact-a',
  artifactDigestSha256: 'a'.repeat(64),
  runtimeAbi: 'vibecanvas:test',
} as TFunctionDefinition;

describe('FunctionResourceGatewayFactory', () => {
  test('resolves resource authority only from the pinned published revision', async () => {
    const gateway = { call: async () => ({ output: { ok: true } }) };
    const bindings = { resolveBinding: async () => null };
    const widgets = {
      getRevision: async () => ({
        definitionId: definition.widgetDefinitionId,
        contractDigestSha256: definition.contractDigestSha256,
        serverArtifact: { id: definition.serverArtifactId, digestSha256: definition.artifactDigestSha256 },
        manifest: {
          server: { runtimeAbi: definition.runtimeAbi },
          resources: [{ slot: 'notes', kind: 'kv', effect: 'read', required: true }],
        },
      }),
    };
    const calls: unknown[] = [];
    const resources = {
      forTenant: async () => ({
        createFunctionResourceGateway: (_tenant: TTenantContext, request: unknown) => {
          calls.push(request);
          return { gateway, bindings };
        },
      }),
    };
    const factory = new FunctionResourceGatewayFactory({
      widgets: widgets as never,
      resources: resources as never,
      permits: {} as never,
      writeCapabilities: {} as never,
    });

    await expect(factory.createInvocationResourceGateway({
      tenant,
      definition,
      envelope: {
        id: 'invocation-a',
        functionId: definition.id,
        widgetRevisionId: definition.widgetRevisionId,
        definitionRevision: definition.definitionRevision,
        subject: { kind: 'widget_instance', canvasId: 'canvas-a', widgetInstanceId: 'widget-a' },
      } as TFunctionInvocationEnvelope,
      attempt: { id: 'attempt-a', invocationId: 'invocation-a', leaseEpoch: 1 } as never,
      getLease: () => ({
        invocationId: 'invocation-a',
        attemptId: 'attempt-a',
        leaseEpoch: 1,
      } as never),
    })).resolves.toBeDefined();
    expect(calls).toEqual([{
      definitionId: definition.widgetDefinitionId,
      revisionId: definition.widgetRevisionId,
      requirements: [{ slot: 'notes', kind: 'kv', effect: 'read', required: true }],
    }]);
  });
});

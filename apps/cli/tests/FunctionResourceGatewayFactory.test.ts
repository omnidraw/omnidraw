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

  test('uses the exact active Preview revision and its retained real bindings', async () => {
    const gateway = { call: async () => ({ output: { ok: true } }) };
    const bindings = { resolveBinding: async () => null };
    const retainedBinding = {
      slot: 'notes',
      resourceId: 'resource-real-a',
      kind: 'kv' as const,
      allowRead: true,
      allowWrite: false,
    };
    const calls: unknown[] = [];
    const widgets = {
      resolvePreviewFunctionTarget: async (_tenant: TTenantContext, request: unknown) => {
        calls.push(['preview', request]);
        return {
          revision: {
            id: definition.widgetRevisionId,
            definitionId: definition.widgetDefinitionId,
            previewContractDigestSha256: definition.contractDigestSha256,
            serverArtifact: {
              id: definition.serverArtifactId,
              kind: 'server',
              digestSha256: definition.artifactDigestSha256,
            },
            manifest: {
              server: { runtimeAbi: definition.runtimeAbi },
              resources: [{
                slot: 'notes',
                kind: 'kv',
                effect: 'read',
                required: true,
              }],
            },
          },
          bindings: [retainedBinding],
        };
      },
      getRevision: async () => {
        throw new Error('Published revision lookup must not run for Preview.');
      },
    };
    const resources = {
      forTenant: async () => ({
        createFunctionResourceGateway: (_tenant: TTenantContext, request: unknown) => {
          calls.push(['resources', request]);
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
        id: 'invocation-preview-a',
        functionId: definition.id,
        widgetRevisionId: definition.widgetRevisionId,
        definitionRevision: definition.definitionRevision,
        subject: {
          kind: 'widget_preview',
          canvasId: 'canvas-a',
          widgetInstanceId: 'preview-a',
        },
      } as TFunctionInvocationEnvelope,
      attempt: {
        id: 'attempt-preview-a',
        invocationId: 'invocation-preview-a',
        leaseEpoch: 1,
      } as never,
      getLease: () => ({
        invocationId: 'invocation-preview-a',
        attemptId: 'attempt-preview-a',
        leaseEpoch: 1,
      } as never),
    })).resolves.toBeDefined();
    expect(calls).toEqual([
      ['preview', {
        previewId: 'preview-a',
        revisionId: definition.widgetRevisionId,
        invocationId: 'invocation-preview-a',
      }],
      ['resources', {
        definitionId: definition.widgetDefinitionId,
        revisionId: definition.widgetRevisionId,
        requirements: [{
          slot: 'notes',
          kind: 'kv',
          effect: 'read',
          required: true,
        }],
        bindings: [retainedBinding],
      }],
    ]);
  });

  test('rejects a stale Preview target before exposing a resource gateway', async () => {
    let resourceLookupCount = 0;
    const factory = new FunctionResourceGatewayFactory({
      widgets: {
        resolvePreviewFunctionTarget: async () => null,
      } as never,
      resources: {
        forTenant: async () => {
          resourceLookupCount += 1;
          throw new Error('Resource service must not be exposed for a stale Preview.');
        },
      } as never,
      permits: {} as never,
      writeCapabilities: {} as never,
    });

    await expect(factory.createInvocationResourceGateway({
      tenant,
      definition,
      envelope: {
        id: 'invocation-stale-preview',
        functionId: definition.id,
        widgetRevisionId: definition.widgetRevisionId,
        definitionRevision: definition.definitionRevision,
        subject: {
          kind: 'widget_preview',
          canvasId: 'canvas-a',
          widgetInstanceId: 'preview-a',
        },
      } as TFunctionInvocationEnvelope,
      attempt: {
        id: 'attempt-stale-preview',
        invocationId: 'invocation-stale-preview',
        leaseEpoch: 1,
      } as never,
      getLease: () => null,
    })).rejects.toMatchObject({
      code: 'FUNCTION_REVISION_NOT_AVAILABLE',
    });
    expect(resourceLookupCount).toBe(0);
  });
});

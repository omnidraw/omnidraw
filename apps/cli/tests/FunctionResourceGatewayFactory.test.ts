import { describe, expect, test } from 'bun:test';
import type { Database } from '@tursodatabase/database';
import type {
  TFunctionAttempt,
  TFunctionDefinition,
  TFunctionInvocationEnvelope,
  TInvocationLease,
} from '@vibecanvas/function-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { FunctionResourceGatewayFactory } from '../src/services/FunctionResourceGatewayFactory';
import type { ResourceServicePool } from '../src/services/ResourceServicePool';
import type { TWidgetServerArtifactCapability } from '../src/services/WidgetServicePool';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-a',
  invocationId: 'invocation-a',
});

const definition: TFunctionDefinition = Object.freeze({
  orgId: tenant.orgId,
  id: 'function-a',
  widgetDefinitionId: 'definition-a',
  widgetRevisionId: 'preview-revision-a',
  name: 'readNotes',
  effect: 'fx',
  definitionRevision: 1,
  serverArtifactId: 'server-artifact-a',
  artifactDigestSha256: 'a'.repeat(64),
  contractDigestSha256: 'b'.repeat(64),
  descriptorDigestSha256: 'c'.repeat(64),
  runtimeAbi: 'vibecanvas:test',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  resources: [{ slot: 'notes', effect: 'read' }],
  limits: {
    timeoutMs: 1_000,
    memoryTier: 'small',
    outputByteLimit: 1_024,
    logByteLimit: 1_024,
  },
  retry: { mode: 'none', maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
});

const envelope: TFunctionInvocationEnvelope = Object.freeze({
  id: 'invocation-a',
  tenant,
  widgetDefinitionId: definition.widgetDefinitionId,
  widgetRevisionId: definition.widgetRevisionId,
  subject: {
    kind: 'agent_preview',
    previewId: 'preview-a',
    previewRevisionId: 'preview-revision-a',
  },
  functionId: definition.id,
  functionName: definition.name,
  definitionRevision: definition.definitionRevision,
  artifactDigestSha256: definition.artifactDigestSha256,
  contractDigestSha256: definition.contractDigestSha256,
  runtimeAbi: definition.runtimeAbi,
  input: {},
  inputDigestSha256: 'd'.repeat(64),
  idempotencyKey: 'key-a',
  policyVersion: 1,
  priority: 0,
  limits: definition.limits,
  retry: definition.retry,
  createdAtMs: 1,
  deadlineAtMs: 1_001,
});

const attempt: TFunctionAttempt = Object.freeze({
  id: 'attempt-a',
  invocationId: envelope.id,
  attemptNumber: 1,
  leaseEpoch: 1,
  status: 'running',
  sandboxDriver: 'test',
  memoryTier: 'small',
  failureOwner: null,
  failure: null,
  metrics: {
    activeWallMs: 0,
    cpuMs: 0,
    allocatedMemoryByteMs: 0,
    peakRssBytes: 0,
    diskReadBytes: 0,
    diskWriteBytes: 0,
    networkRxBytes: 0,
    networkTxBytes: 0,
  },
  outputByteSize: 0,
  logByteSize: 0,
  coldStart: true,
  billable: false,
  createdAtMs: 1,
  startedAtMs: 2,
  guestCodeEnteredAtMs: 3,
  finishedAtMs: null,
});

const lease: TInvocationLease = Object.freeze({
  invocationId: envelope.id,
  attemptId: attempt.id,
  leaseEpoch: 1,
  workerId: 'worker-a',
  heartbeatAtMs: 3,
  expiresAtMs: 1_000,
});

describe('FunctionResourceGatewayFactory', () => {
  test('loads preview bindings by immutable preview revision without published revision lookup', async () => {
    const databaseCalls: unknown[][] = [];
    const database = {
      prepare: () => ({
        all: async (...values: unknown[]) => {
          databaseCalls.push(values);
          return [{
            slot_name: 'notes',
            resource_id: 'resource-a',
            resource_kind: 'kv',
            is_required: 1,
            allow_read: 1,
            allow_write: 0,
          }];
        },
      }),
    } as unknown as Database;
    const widgets = {
      getPreviewRevision: async () => ({
        id: envelope.widgetRevisionId,
        previewId: 'preview-a',
        definitionId: definition.widgetDefinitionId,
        contractDigestSha256: definition.contractDigestSha256,
        manifest: {
          schemaVersion: 2,
          name: 'Preview',
          slug: 'preview',
          ui: { entry: 'ui/main.ts' },
          server: { entry: 'server/index.ts', runtimeAbi: definition.runtimeAbi },
          resources: [{ slot: 'notes', kind: 'kv', effect: 'read', required: true }],
        },
        serverArtifact: {
          id: definition.serverArtifactId,
          digestSha256: definition.artifactDigestSha256,
        },
      }),
      getRevision: async () => {
        throw new Error('published revision path must not run');
      },
    } as unknown as TWidgetServerArtifactCapability;
    const previewRequests: unknown[] = [];
    const resources = {
      forTenant: async () => ({
        createPreviewFunctionResourceGateway: (_tenant: TTenantContext, request: unknown) => {
          previewRequests.push(request);
          return {
            gateway: { call: async () => ({ output: { ok: true } }) },
            bindings: { resolveBinding: async () => null },
          };
        },
      }),
    } as unknown as ResourceServicePool;
    const factory = new FunctionResourceGatewayFactory({
      database,
      widgets,
      resources,
      permits: {} as never,
      writeCapabilities: {} as never,
      nowMs: () => 100,
    });

    await expect(factory.createInvocationResourceGateway({
      tenant,
      definition,
      envelope,
      attempt,
      getLease: () => lease,
    })).resolves.toBeDefined();
    expect(databaseCalls).toEqual([[tenant.orgId, 'preview-a', 'preview-revision-a']]);
    expect(previewRequests).toEqual([{
      requirements: [{ slot: 'notes', kind: 'kv', effect: 'read', required: true }],
      bindings: [{
        slot: 'notes',
        resourceId: 'resource-a',
        kind: 'kv',
        required: true,
        allowRead: true,
        allowWrite: false,
        definitionId: definition.widgetDefinitionId,
        revisionId: definition.widgetRevisionId,
      }],
    }]);
  });
});

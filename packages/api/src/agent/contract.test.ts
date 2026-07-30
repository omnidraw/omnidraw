import { describe, expect, test } from 'bun:test';
import { oc, populateContractRouterPaths } from '@orpc/contract';
import {
  ZAgentWidgetPublishInput,
  ZAgentWidgetPreviewResult,
  ZAgentWidgetPublishResult,
} from './authoring-schema';
import { agentContract } from './contract';
import { agentHandlers } from './handlers';

const draftId = '00000000-0000-4000-8000-000000000001';
const definitionId = '00000000-0000-4000-8000-000000000002';
const publishedRevisionId = '00000000-0000-4000-8000-000000000003';
const revision = 'a'.repeat(64);
const apis = ['DOM'] as const;
const runtimeDescriptor = {
  format: 'vibecanvas.capsule-runtime.v2',
  capsuleArtifactHash: `sha256:${'b'.repeat(64)}`,
  apiContract: {
    format: 'capsule-api-groups-v1',
    groups: apis,
    bundleDigest: `sha256:${'c'.repeat(64)}`,
  },
  budgets: {
    cpuMs: 50,
    memoryBytes: 8 * 1_024 * 1_024,
    domNodes: 1_000,
    handles: 1_000,
    messageBytes: 1_024 * 1_024,
    streamBytes: 1_024 * 1_024,
    assetBytes: 4 * 1_024 * 1_024,
    networkBytes: 0,
    gpuBytes: 0,
    lifecycleBytes: 64 * 1_024,
  },
  capabilityRequests: [],
  channels: null,
  parkability: { parkable: false },
  signatureKeyIds: ['vibecanvas-preview-v1'],
};
const manifest = {
  schemaVersion: 3,
  name: 'Clock',
  slug: 'clock',
  ui: { runtime: 'capsule', entry: 'src/ui.ts', apis },
};

function api() {
  return populateContractRouterPaths(oc.router({ api: oc.router({ agent: agentContract }) })).api.agent;
}

describe('agent authoring contract', () => {
  test('preserves the stateless build route and adds durable owner lifecycle routes', () => {
    const contract = api();
    expect(contract.widgetPreview.build['~orpc'].route.path).toBe('/api/agent/widgetPreview/build');
    expect(contract.widgetPreview.cancel['~orpc'].route.path).toBe('/api/agent/widgetPreview/cancel');
    expect(contract.widgetPreview.mount.acquire['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/mount/acquire');
    expect(contract.widgetPreview.mount.renew['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/mount/renew');
    expect(contract.widgetPreview.mount.release['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/mount/release');
    expect(contract.widgetPreview.owner.ensure['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/owner/ensure');
    expect(contract.widgetPreview.owner.get['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/owner/get');
    expect(contract.widgetPreview.owner.list['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/owner/list');
    expect(contract.widgetPreview.owner.close['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/owner/close');
    expect(contract.widgetPreview.diagnostics.report['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/diagnostics/report');
    expect(contract.widgetPreview.diagnostics.get['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/diagnostics/get');
    expect(contract.widgetPreview.diagnostics.retest['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/diagnostics/retest');
    expect(contract.widgetPreview.diagnostics.resolve['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/diagnostics/resolve');
    expect(Object.keys(agentHandlers.widgetPreview)).toEqual([
      'build',
      'cancel',
      'mount',
      'diagnostics',
      'owner',
    ]);
    expect(Object.keys(agentHandlers.widgetPreview.mount)).toEqual([
      'acquire',
      'renew',
      'release',
    ]);
    expect(Object.keys(agentHandlers.widgetPreview.owner)).toEqual([
      'ensure',
      'get',
      'list',
      'close',
    ]);
    expect(Object.keys(agentHandlers.widgetPreview.diagnostics)).toEqual([
      'report',
      'get',
      'retest',
      'resolve',
    ]);
  });

  test('requires the exact pending Preview build fence for cancellation', () => {
    const schema = api().widgetPreview.cancel['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const input = {
      previewId: crypto.randomUUID(),
      canvasId: 'canvas-cancel',
      frameNodeId: 'frame-cancel',
      buildId: crypto.randomUUID(),
      expectedBuildSequence: 4,
    };
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({
      ...input,
      buildId: undefined,
    }).success).toBe(false);
    expect(schema.safeParse({
      ...input,
      expectedBuildSequence: -1,
    }).success).toBe(false);
  });

  test('requires an exact frame/revision-scoped structured runtime diagnostic', () => {
    const schema = api().widgetPreview.diagnostics.report['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const report = {
      previewId: '00000000-0000-4000-8000-000000000031',
      canvasId: 'canvas-a',
      frameNodeId: 'frame-a',
      draftId,
      originChatId: '00000000-0000-4000-8000-000000000032',
      diagnostic: {
        formatVersion: 1,
        fingerprint: 'f'.repeat(64),
        origin: 'guest',
        phase: 'runtime',
        code: 'WIDGET_GUEST_RUNTIME_FAILED',
        severity: 'error',
        message: 'Guest render failed.',
        trust: 'untrusted',
        draftRevision: revision,
        previewRevisionId: '00000000-0000-4000-8000-000000000033',
        buildId: '00000000-0000-4000-8000-000000000033',
        buildSequence: 2,
        occurrenceCount: 1,
        retryability: 'unknown',
        timestampMs: 10,
        file: 'widget://ui/main.ts',
        line: 4,
        column: 2,
      },
    };
    expect(schema.safeParse(report).success).toBe(true);
    expect(schema.safeParse({
      ...report,
      diagnostic: { ...report.diagnostic, hostPath: '/private/widget.ts' },
    }).success).toBe(false);
    expect(schema.safeParse({
      ...report,
      frameNodeId: undefined,
    }).success).toBe(false);

    const diagnostics = api().widgetPreview.diagnostics;
    const getSchema = diagnostics.get['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const resolveSchema = diagnostics.resolve['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const retestSchema = diagnostics.retest['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const ownerRef = {
      previewId: report.previewId,
      canvasId: report.canvasId,
      frameNodeId: report.frameNodeId,
    };
    const selection = {
      ...ownerRef,
      previewRevisionId: report.diagnostic.previewRevisionId,
      fingerprint: report.diagnostic.fingerprint,
    };
    expect(getSchema.safeParse(ownerRef).success).toBe(true);
    expect(resolveSchema.safeParse(selection).success).toBe(true);
    expect(retestSchema.safeParse({
      ...selection,
      operation: 'resource.read',
    }).success).toBe(true);
    expect(retestSchema.safeParse(selection).success).toBe(false);
    expect(resolveSchema.safeParse({
      ...selection,
      fingerprint: 'not-a-fingerprint',
    }).success).toBe(false);
  });

  test('accepts stateless or fully frame-qualified Preview builds', () => {
    const schema = api().widgetPreview.build['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ draftId }).success).toBe(true);
    expect(schema.safeParse({ draftId, previewId: crypto.randomUUID() }).success).toBe(false);
    expect(schema.safeParse({
      draftId,
      previewId: crypto.randomUUID(),
      canvasId: 'canvas-a',
      frameNodeId: 'frame-a',
    }).success).toBe(true);
    expect(schema.safeParse({ draftId: 'Clock' }).success).toBe(false);
  });

  test('accepts only exact persisted Preview owner identities and bounded queries', () => {
    const owner = api().widgetPreview.owner;
    const ensureSchema = owner.ensure['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const ensure = {
      previewId: '00000000-0000-4000-8000-000000000011',
      canvasId: 'canvas-a',
      frameNodeId: 'frame-a',
      draftId,
      originChatId: '00000000-0000-4000-8000-000000000012',
      role: 'companion',
    };
    expect(ensureSchema.safeParse(ensure).success).toBe(true);
    expect(ensureSchema.safeParse({ ...ensure, role: 'published' }).success).toBe(false);
    expect(ensureSchema.safeParse({ ...ensure, nowMs: 123 }).success).toBe(false);

    const listSchema = owner.list['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    expect(listSchema.safeParse({}).success).toBe(false);
    expect(listSchema.safeParse({
      canvasId: ensure.canvasId,
      draftId,
      includeClosed: true,
    }).success).toBe(true);
    expect(listSchema.safeParse({ canvasId: ' canvas-a' }).success).toBe(false);

    const closeSchema = owner.close['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    expect(closeSchema.safeParse({
      previewId: ensure.previewId,
      canvasId: ensure.canvasId,
      frameNodeId: ensure.frameNodeId,
    }).success).toBe(true);
    expect(closeSchema.safeParse({ previewId: ensure.previewId }).success).toBe(false);
  });

  test('accepts exact mount lease identity while rejecting caller timing fields', () => {
    const mount = api().widgetPreview.mount;
    const inputSchema = mount.acquire['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const outputSchema = mount.acquire['~orpc'].outputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const input = {
      leaseId: '00000000-0000-4000-8000-000000000051',
      previewId: '00000000-0000-4000-8000-000000000052',
      previewRevisionId: '00000000-0000-4000-8000-000000000053',
      canvasId: 'canvas-mount',
      frameNodeId: 'frame-mount',
    };
    expect(inputSchema.safeParse(input).success).toBe(true);
    expect(inputSchema.safeParse({ ...input, nowMs: 10 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...input, ttlMs: 60_000 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...input, leaseId: 'not-a-uuid' }).success).toBe(false);
    expect(outputSchema.safeParse({
      ...input,
      acquiredAtMs: 10,
      renewedAtMs: 20,
      expiresAtMs: 60_020,
    }).success).toBe(true);
    expect(outputSchema.safeParse(null).success).toBe(true);
  });


  test('accepts published and draft placement references only', () => {
    const schema = api().widgets.resolvePlacement['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const expectedDraftId = '00000000-0000-4000-8000-000000000001';
    expect(schema.safeParse({ reference: { source: 'published', name: 'Clock', revision: 'r1' } }).success).toBe(true);
    expect(schema.safeParse({ reference: { source: 'draft', name: 'Clock', revision: 'r1' }, expectedDraftId }).success).toBe(true);
    expect(schema.safeParse({ reference: { source: 'preview', name: 'Clock', revision: 'r1' }, expectedDraftId }).success).toBe(false);
  });

  test('requires exact signed Capsule bytes and runtime metadata in preview responses', () => {
    const preview = {
      ready: true,
      draftId,
      definitionId,
      previewId: null,
      previewRevisionId: null,
      buildSequence: null,
      committedMutationId: 'mutation-preview-contract',
      bindingRevision: null,
      bindingPlanDigestSha256: null,
      name: 'Clock',
      revision,
      manifest,
      uiArtifact: {
        digestSha256: 'c'.repeat(64),
        byteSize: 7,
        bytesBase64: 'Y2Fwc3VsZQ==',
        runtimeDescriptor,
      },
      contract: {
        digestSha256: 'd'.repeat(64),
        functions: [],
        browserFunctionDescriptorsDigestSha256: 'e'.repeat(64),
      },
      diagnostics: [],
    };
    expect(ZAgentWidgetPreviewResult.safeParse(preview).success).toBe(true);
    expect(ZAgentWidgetPreviewResult.safeParse({
      ...preview,
      contract: {
        digestSha256: preview.contract.digestSha256,
        functions: preview.contract.functions,
      },
    }).success).toBe(false);
    expect(ZAgentWidgetPreviewResult.safeParse({
      ...preview,
      uiArtifact: { ...preview.uiArtifact, byteSize: 6 },
    }).success).toBe(false);
    expect(ZAgentWidgetPreviewResult.safeParse({
      ...preview,
      uiArtifact: {
        ...preview.uiArtifact,
        runtimeDescriptor: { ...runtimeDescriptor, privateKey: 'forbidden' },
      },
    }).success).toBe(false);
    expect(ZAgentWidgetPreviewResult.safeParse({
      ...preview,
      uiArtifact: {
        ...preview.uiArtifact,
        runtimeDescriptor: { ...runtimeDescriptor, signatureKeyIds: [] },
      },
    }).success).toBe(false);
  });

  test('requires manifest v3 and signed Capsule runtime metadata in publication responses', () => {
    const result = {
      published: true,
      draftId,
      definitionId,
      revision,
      publishedRevisionId,
      manifest,
      uiRuntime: runtimeDescriptor,
    };
    expect(ZAgentWidgetPublishResult.safeParse(result).success).toBe(true);
    expect(ZAgentWidgetPublishResult.safeParse({
      ...result,
      manifest: { ...manifest, schemaVersion: 2 },
    }).success).toBe(false);
    expect(ZAgentWidgetPublishResult.safeParse({
      ...result,
      uiRuntime: { ...runtimeDescriptor, signatureKeyIds: [] },
    }).success).toBe(false);
  });

  test('requires exact frame-owned Preview identity for publication requests', () => {
    const request = {
      idempotencyKey: 'publish-mounted-preview',
      draftId,
      expectedRevision: revision,
      previewId: '00000000-0000-4000-8000-000000000071',
      previewRevisionId: '00000000-0000-4000-8000-000000000072',
      canvasId: 'canvas-published-preview',
      frameNodeId: 'frame-published-preview',
      expectedBindingRevision: 2,
      expectedBindingPlanDigestSha256: 'd'.repeat(64),
    };
    expect(ZAgentWidgetPublishInput.safeParse(request).success).toBe(true);
    expect(ZAgentWidgetPublishInput.safeParse({
      draftId,
      expectedRevision: revision,
    }).success).toBe(false);
    expect(ZAgentWidgetPublishInput.safeParse({
      ...request,
      previewRevisionId: undefined,
    }).success).toBe(false);
    expect(ZAgentWidgetPublishInput.safeParse({
      ...request,
      expectedBindingPlanDigestSha256: undefined,
    }).success).toBe(false);
    expect(ZAgentWidgetPublishInput.safeParse({
      ...request,
      expectedBindingPlanDigestSha256: 'not-a-digest',
    }).success).toBe(false);
  });
});

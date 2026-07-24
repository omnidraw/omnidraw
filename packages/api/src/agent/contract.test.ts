import { describe, expect, test } from 'bun:test';
import { oc, populateContractRouterPaths } from '@orpc/contract';
import {
  ZAgentWidgetPreviewResult,
  ZAgentWidgetPublishResult,
} from './authoring-schema';
import { agentContract } from './contract';
import { agentHandlers } from './handlers';

const draftId = '00000000-0000-4000-8000-000000000001';
const definitionId = '00000000-0000-4000-8000-000000000002';
const publishedRevisionId = '00000000-0000-4000-8000-000000000003';
const revision = 'a'.repeat(64);
const target = {
  runtimeAbi: 'quickjs-release-sync-v1',
  domProfile: 'dom-core-v2',
  featureProfiles: [],
};
const runtimeDescriptor = {
  format: 'vibecanvas.capsule-runtime.v1',
  capsuleArtifactHash: `sha256:${'b'.repeat(64)}`,
  target,
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
  ui: { runtime: 'capsule', entry: 'src/ui.ts', target },
};

function api() {
  return populateContractRouterPaths(oc.router({ api: oc.router({ agent: agentContract }) })).api.agent;
}

describe('agent authoring contract', () => {
  test('exposes one stateless Preview build route', () => {
    const contract = api();
    expect(contract.widgetPreview.build['~orpc'].route.path).toBe('/api/agent/widgetPreview/build');
    expect(Object.keys(agentHandlers.widgetPreview)).toEqual(['build']);
  });

  test('accepts only a durable draft id for Preview build', () => {
    const schema = api().widgetPreview.build['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ draftId }).success).toBe(true);
    expect(schema.safeParse({ draftId, previewId: crypto.randomUUID() }).success).toBe(false);
    expect(schema.safeParse({ draftId: 'Clock' }).success).toBe(false);
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
});

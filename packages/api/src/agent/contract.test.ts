import { describe, expect, test } from 'bun:test';
import { oc, populateContractRouterPaths } from '@orpc/contract';
import { agentContract } from './contract';
import { agentHandlers } from './handlers';

describe('agent chat contract', () => {
  test('exposes neutral authoring routes without actor-era chat controls', () => {
    const contract = oc.router({ agent: agentContract });
    const apiContract = populateContractRouterPaths(oc.router({ api: contract }));
    const legacyNamespace = ['wiz', 'zard'].join('');

    expect(apiContract.api.agent.chat.connect['~orpc'].route.path).toBe('/api/agent/chat/connect');
    expect(apiContract.api.agent.widgetDraft.list['~orpc'].route.path).toBe('/api/agent/widgetDraft/list');
    expect(apiContract.api.agent.widgetPreview.build['~orpc'].route.path).toBe('/api/agent/widgetPreview/build');
    expect(apiContract.api.agent.widgetPreview.close['~orpc'].route.path).toBe('/api/agent/widgetPreview/close');
    expect(apiContract.api.agent.widgetPreview.invoke['~orpc'].route.path).toBe('/api/agent/widgetPreview/invoke');
    expect(apiContract.api.agent.widgetPreview.invocation.get['~orpc'].route.path)
      .toBe('/api/agent/widgetPreview/invocation/get');
    expect(apiContract.api.agent.widgetPublish.publish['~orpc'].route.path).toBe('/api/agent/widgetPublish/publish');
    expect(apiContract.api.agent.widgets.catalog['~orpc'].route.path).toBe('/api/agent/widgets/catalog');
    expect(apiContract.api.agent.widgets.detail['~orpc'].route.path).toBe('/api/agent/widgets/detail');
    expect(apiContract.api.agent.widgets.files['~orpc'].route.path).toBe('/api/agent/widgets/files');
    expect(apiContract.api.agent.widgets.file['~orpc'].route.path).toBe('/api/agent/widgets/file');
    expect(apiContract.api.agent.widgets.ensureDraft['~orpc'].route.path).toBe('/api/agent/widgets/ensureDraft');
    expect(apiContract.api.agent.widgets.patchDraftTool['~orpc'].route.path).toBe('/api/agent/widgets/patchDraftTool');
    expect(apiContract.api.agent.widgets.patchDraftMetadata['~orpc'].route.path).toBe('/api/agent/widgets/patchDraftMetadata');
    expect(apiContract.api.agent.widgets.delete['~orpc'].route.path).toBe('/api/agent/widgets/delete');
    expect(apiContract.api.agent.widgets.resolvePlacement['~orpc'].route.path).toBe('/api/agent/widgets/resolvePlacement');
    expect(apiContract.api.agent.widgets.groups.update['~orpc'].route.path).toBe('/api/agent/widgets/groups/update');
    expect(apiContract.api.agent.approval.resolve['~orpc'].route.path).toBe('/api/agent/approval/resolve');
    expect(Object.hasOwn(apiContract.api.agent, legacyNamespace)).toBe(false);
    expect(Object.hasOwn(apiContract.api.agent.chat, 'draftActor')).toBe(false);
    expect(Object.hasOwn(apiContract.api.agent.chat, 'previewSource')).toBe(false);
    expect(Object.hasOwn(apiContract.api.agent.chat, 'draftManifest')).toBe(false);
    expect(Object.hasOwn(apiContract.api.agent.chat, 'publish')).toBe(false);
    expect(Object.hasOwn(apiContract.api.agent.widgetPreview, 'refresh')).toBe(false);
    expect(Object.hasOwn(apiContract.api.agent.widgetPreview, 'reset')).toBe(false);
    expect(Object.hasOwn(apiContract.api.agent.widgetPreview, 'send')).toBe(false);
    expect(Object.keys(agentHandlers.widgetPreview).sort()).toEqual([
      'build',
      'close',
      'get',
      'invocation',
      'invoke',
    ]);
    expect(Object.hasOwn(agentHandlers, 'widgetPublish')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'widgets')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'approval')).toBe(true);
    expect(Object.hasOwn(agentHandlers, legacyNamespace)).toBe(false);
  });

  test('validates source-explicit placement identities and Preview owners', () => {
    const contract = oc.router({ agent: agentContract });
    const apiContract = populateContractRouterPaths(oc.router({ api: contract }));
    const schema = apiContract.api.agent.widgets.resolvePlacement['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const expectedDraftId = '00000000-0000-4000-8000-000000000001';
    expect(schema.safeParse({ reference: { source: 'published', name: 'Weather', revision: 'r1' } }).success).toBe(true);
    expect(schema.safeParse({ reference: { source: 'draft', name: 'Weather', revision: 'r1' }, previewId: 'drop-1' }).success).toBe(false);
    expect(schema.safeParse({ reference: { source: 'draft', name: 'Weather', revision: 'r1' }, previewId: 'drop-1', expectedDraftId }).success).toBe(true);
    expect(schema.safeParse({ reference: { source: 'preview', name: 'Weather', revision: 'r1' }, previewId: 'drop-1', expectedDraftId }).success).toBe(true);
    expect(schema.safeParse({ reference: { source: 'preview', name: 'Weather', revision: 'r1' }, previewId: 'drop-1', expectedDraftId: 'not-a-draft-id' }).success).toBe(false);
    expect(schema.safeParse({ reference: { source: 'mutable', name: 'Weather', revision: 'r1' } }).success).toBe(false);
    expect(schema.safeParse({ reference: { source: 'draft', name: '../Weather', revision: 'r1' }, previewId: 'drop-1' }).success).toBe(false);
  });

  test('requires opaque draft and immutable Preview identities on every operation', () => {
    const contract = oc.router({ agent: agentContract });
    const apiContract = populateContractRouterPaths(oc.router({ api: contract }));
    const preview = apiContract.api.agent.widgetPreview;
    const draftId = '00000000-0000-4000-8000-000000000001';
    const previewRevisionId = '00000000-0000-4000-8000-000000000002';
    const invocationId = '00000000-0000-4000-8000-000000000003';
    const previewId = '00000000-0000-4000-8000-000000000004';
    const revision = 'a'.repeat(64);
    const cases = [
      [preview.get, { draftId }],
      [preview.build, {
        draftId,
        expectedDraftRevision: revision,
        expectedActivePreviewRevisionId: null,
      }],
      [preview.close, { draftId, expectedPreviewRevisionId: previewRevisionId }],
      [preview.invoke, {
        draftId,
        previewRevisionId,
        functionName: 'tick',
        input: null,
        idempotencyKey: 'preview:tick:1',
      }],
      [preview.invocation.get, { draftId, previewRevisionId, invocationId }],
      [preview.invocation.cancel, { draftId, previewRevisionId, invocationId }],
    ] as const;

    for (const [procedure, inputWithoutOwner] of cases) {
      const inputSchema = procedure['~orpc'].inputSchema as {
        safeParse: (input: unknown) => { success: boolean };
      };
      expect(inputSchema.safeParse(inputWithoutOwner).success).toBe(false);
      expect(inputSchema.safeParse({ ...inputWithoutOwner, previewId }).success).toBe(true);
      expect(inputSchema.safeParse({ ...inputWithoutOwner, draftId: 'Weather', previewId }).success).toBe(false);
      expect(inputSchema.safeParse({ ...inputWithoutOwner, previewId: 'canvas-element-1' }).success).toBe(false);
      expect(inputSchema.safeParse({ ...inputWithoutOwner, previewId: '../canvas-element-1' }).success).toBe(false);
      expect(inputSchema.safeParse({
        ...inputWithoutOwner,
        previewId,
        unexpected: true,
      }).success).toBe(false);
    }
  });

  test('strictly bounds authoring identities, revisions, names, inputs, and unknown fields', () => {
    const contract = oc.router({ agent: agentContract });
    const apiContract = populateContractRouterPaths(oc.router({ api: contract }));
    const draftId = '00000000-0000-4000-8000-000000000001';
    const previewRevisionId = '00000000-0000-4000-8000-000000000002';
    const previewId = 'a0000000-0000-4000-8000-000000000003';
    const revision = 'a'.repeat(64);
    const buildSchema = apiContract.api.agent.widgetPreview.build['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const invokeSchema = apiContract.api.agent.widgetPreview.invoke['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const publishSchema = apiContract.api.agent.widgetPublish.publish['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const listSchema = apiContract.api.agent.widgetDraft.list['~orpc'].inputSchema as {
      safeParse: (input: unknown) => { success: boolean };
    };
    const validBuild = {
      draftId,
      previewId,
      expectedDraftRevision: revision,
      expectedActivePreviewRevisionId: null,
    };
    const validInvoke = {
      draftId,
      previewId,
      previewRevisionId,
      functionName: 'tick',
      input: { amount: 1 },
      idempotencyKey: 'preview:tick:1',
    };

    expect(buildSchema.safeParse(validBuild).success).toBe(true);
    expect(buildSchema.safeParse({ ...validBuild, draftId: 'Weather' }).success).toBe(false);
    expect(buildSchema.safeParse({ ...validBuild, expectedDraftRevision: 'A'.repeat(64) }).success).toBe(false);
    expect(buildSchema.safeParse({ ...validBuild, expectedDraftRevision: 'a'.repeat(63) }).success).toBe(false);
    expect(buildSchema.safeParse({ ...validBuild, previewId: previewId.toUpperCase() }).success).toBe(false);
    expect(buildSchema.safeParse({ ...validBuild, previewId: 'x'.repeat(201) }).success).toBe(false);
    expect(buildSchema.safeParse({ ...validBuild, unexpected: true }).success).toBe(false);
    expect(invokeSchema.safeParse(validInvoke).success).toBe(true);
    expect(invokeSchema.safeParse({ ...validInvoke, functionName: 'bad.name' }).success).toBe(false);
    expect(invokeSchema.safeParse({ ...validInvoke, functionName: `f${'x'.repeat(128)}` }).success).toBe(false);
    expect(invokeSchema.safeParse({ ...validInvoke, idempotencyKey: 'x'.repeat(201) }).success).toBe(false);
    expect(invokeSchema.safeParse({ ...validInvoke, input: undefined }).success).toBe(false);
    expect(invokeSchema.safeParse({ ...validInvoke, input: 'x'.repeat(1_048_577) }).success).toBe(false);
    expect(invokeSchema.safeParse({ ...validInvoke, unexpected: true }).success).toBe(false);
    expect(publishSchema.safeParse({ draftId, expectedRevision: revision }).success).toBe(true);
    expect(publishSchema.safeParse({ draftId, expectedRevision: revision, unexpected: true }).success).toBe(false);
    expect(listSchema.safeParse({}).success).toBe(true);
    expect(listSchema.safeParse({ orgId: 'caller-selected-org' }).success).toBe(false);
  });

  test('exposes only bounded UI artifacts and browser-safe function descriptors', () => {
    const contract = oc.router({ agent: agentContract });
    const apiContract = populateContractRouterPaths(oc.router({ api: contract }));
    const outputSchema = apiContract.api.agent.widgetPreview.build['~orpc'].outputSchema as {
      safeParse: (output: unknown) => { success: boolean };
    };
    const digest = 'a'.repeat(64);
    const output = {
      ready: true,
      draftId: '00000000-0000-4000-8000-000000000001',
      definitionId: '00000000-0000-4000-8000-000000000002',
      name: 'Clock',
      previewId: '00000000-0000-4000-8000-000000000004',
      previewRevisionId: '00000000-0000-4000-8000-000000000003',
      revision: digest,
      currentRevision: digest,
      stale: false,
      manifest: {
        schemaVersion: 2,
        name: 'Clock',
        slug: 'clock',
        ui: { entry: 'ui/main.ts' },
      },
      uiArtifact: {
        digestSha256: digest,
        byteSize: 1,
        bytesBase64: 'AQ==',
      },
      contract: {
        digestSha256: digest,
        functions: [{
          schemaVersion: 1,
          exportName: 'tick',
          effect: 'fn',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          resources: [],
          limits: {
            timeoutMs: 1_000,
            memoryTier: 'small',
            outputByteLimit: 1_024,
            logByteLimit: 1_024,
          },
          retry: {
            mode: 'none',
            maxAttempts: 1,
            initialBackoffMs: 0,
            maxBackoffMs: 0,
          },
        }],
      },
      diagnostics: [],
      expiresAtMs: 1,
    };

    expect(outputSchema.safeParse(output).success).toBe(true);
    expect(outputSchema.safeParse({
      ...output,
      uiArtifact: { ...output.uiArtifact, byteSize: 2 },
    }).success).toBe(false);
    expect(outputSchema.safeParse({
      ...output,
      contract: {
        ...output.contract,
        functions: [{ ...output.contract.functions[0], modulePath: 'server/main.ts' }],
      },
    }).success).toBe(false);
    expect(outputSchema.safeParse({ ...output, serverArtifact: { digestSha256: digest } }).success).toBe(false);

    const overLimitBase64 = 'AAAA'.repeat(Math.ceil((16 * 1_024 * 1_024 + 1) / 3));
    expect(outputSchema.safeParse({
      ...output,
      uiArtifact: {
        ...output.uiArtifact,
        byteSize: 16 * 1_024 * 1_024 + 1,
        bytesBase64: overLimitBase64,
      },
    }).success).toBe(false);

    const invocationOutputSchema = apiContract.api.agent.widgetPreview.invoke['~orpc'].outputSchema as {
      safeParse: (invocation: unknown) => { success: boolean };
    };
    const invocation = {
      id: '00000000-0000-4000-8000-000000000004',
      functionName: 'tick',
      previewId: output.previewId,
      previewRevisionId: output.previewRevisionId,
      status: 'succeeded',
      output: { ok: true },
      failure: null,
      createdAtMs: 1,
      startedAtMs: 2,
      finishedAtMs: 3,
    };
    expect(invocationOutputSchema.safeParse(invocation).success).toBe(true);
    expect(invocationOutputSchema.safeParse({
      ...invocation,
      output: 'x'.repeat(1_048_577),
    }).success).toBe(false);
  });
});

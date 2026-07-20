import { describe, expect, test } from 'bun:test';
import { oc, populateContractRouterPaths } from '@orpc/contract';
import { agentContract } from './contract';
import { agentHandlers } from './handlers';

describe('agent chat contract', () => {
  test('exposes chat routes without the legacy namespace', () => {
    const contract = oc.router({ agent: agentContract });
    const apiContract = populateContractRouterPaths(oc.router({ api: contract }));
    const legacyNamespace = ['wiz', 'zard'].join('');

    expect(apiContract.api.agent.chat.connect['~orpc'].route.path).toBe('/api/agent/chat/connect');
    expect(apiContract.api.agent.chat.draftActor.start['~orpc'].route.path).toBe('/api/agent/chat/draftActor/start');
    expect(apiContract.api.agent.widgetDraft.list['~orpc'].route.path).toBe('/api/agent/widgetDraft/list');
    expect(apiContract.api.agent.widgetPreview.build['~orpc'].route.path).toBe('/api/agent/widgetPreview/build');
    expect(apiContract.api.agent.widgetPreview.close['~orpc'].route.path).toBe('/api/agent/widgetPreview/close');
    expect(apiContract.api.agent.widgetPublish.publish['~orpc'].route.path).toBe('/api/agent/widgetPublish/publish');
    expect(apiContract.api.agent.widgets.catalog['~orpc'].route.path).toBe('/api/agent/widgets/catalog');
    expect(apiContract.api.agent.widgets.detail['~orpc'].route.path).toBe('/api/agent/widgets/detail');
    expect(apiContract.api.agent.widgets.files['~orpc'].route.path).toBe('/api/agent/widgets/files');
    expect(apiContract.api.agent.widgets.file['~orpc'].route.path).toBe('/api/agent/widgets/file');
    expect(apiContract.api.agent.widgets.ensureDraft['~orpc'].route.path).toBe('/api/agent/widgets/ensureDraft');
    expect(apiContract.api.agent.widgets.patchDraftTool['~orpc'].route.path).toBe('/api/agent/widgets/patchDraftTool');
    expect(apiContract.api.agent.widgets.patchDraftMetadata['~orpc'].route.path).toBe('/api/agent/widgets/patchDraftMetadata');
    expect(apiContract.api.agent.widgets.delete['~orpc'].route.path).toBe('/api/agent/widgets/delete');
    expect(apiContract.api.agent.widgets.groups.update['~orpc'].route.path).toBe('/api/agent/widgets/groups/update');
    expect(apiContract.api.agent.approval.resolve['~orpc'].route.path).toBe('/api/agent/approval/resolve');
    expect(Object.hasOwn(apiContract.api.agent, legacyNamespace)).toBe(false);
    expect(Object.hasOwn(agentHandlers, 'chat')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'widgetDraft')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'widgetPreview')).toBe(true);
    expect(Object.hasOwn(agentHandlers.widgetPreview, 'close')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'widgetPublish')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'widgets')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'approval')).toBe(true);
    expect(Object.hasOwn(agentHandlers, legacyNamespace)).toBe(false);
  });

  test('requires an owner previewId on every widget Preview operation', () => {
    const contract = oc.router({ agent: agentContract });
    const apiContract = populateContractRouterPaths(oc.router({ api: contract }));
    const preview = apiContract.api.agent.widgetPreview;
    const cases = [
      [preview.get, { draftId: 'Weather' }],
      [preview.build, { draftId: 'Weather', expectedRevision: 'revision-1' }],
      [preview.refresh, { draftId: 'Weather', expectedRevision: 'revision-1' }],
      [preview.reset, { draftId: 'Weather', expectedRevision: 'revision-1' }],
      [preview.close, { draftId: 'Weather', expectedRevision: 'revision-1' }],
      [preview.send, { draftId: 'Weather', expectedRevision: 'revision-1', name: 'tick', payload: null }],
    ] as const;

    for (const [procedure, inputWithoutOwner] of cases) {
      const inputSchema = procedure['~orpc'].inputSchema as {
        safeParse: (input: unknown) => { success: boolean };
      };
      expect(inputSchema.safeParse(inputWithoutOwner).success).toBe(false);
      expect(inputSchema.safeParse({ ...inputWithoutOwner, previewId: 'canvas-element-1' }).success).toBe(true);
      expect(inputSchema.safeParse({ ...inputWithoutOwner, draftId: '  Weather ', previewId: 'canvas-element-1' }).success).toBe(false);
      expect(inputSchema.safeParse({ ...inputWithoutOwner, draftId: 'Weather  Report', previewId: 'canvas-element-1' }).success).toBe(false);
    }
  });
});

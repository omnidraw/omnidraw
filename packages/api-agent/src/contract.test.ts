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
    expect(Object.hasOwn(agentHandlers, 'widgetPublish')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'widgets')).toBe(true);
    expect(Object.hasOwn(agentHandlers, 'approval')).toBe(true);
    expect(Object.hasOwn(agentHandlers, legacyNamespace)).toBe(false);
  });
});

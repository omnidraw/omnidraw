import { describe, expect, test } from 'bun:test';
import { oc, populateContractRouterPaths } from '@orpc/contract';
import { agentContract } from './contract';
import { agentHandlers } from './handlers';

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
    const draftId = '00000000-0000-4000-8000-000000000001';
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
});

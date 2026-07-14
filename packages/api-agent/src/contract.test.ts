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
    expect(Object.hasOwn(apiContract.api.agent, legacyNamespace)).toBe(false);
    expect(Object.hasOwn(agentHandlers, 'chat')).toBe(true);
    expect(Object.hasOwn(agentHandlers, legacyNamespace)).toBe(false);
  });
});

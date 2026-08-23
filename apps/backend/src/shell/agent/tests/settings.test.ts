import { describe, expect, test } from 'bun:test';
import { AgentService } from '../AgentService';
import {
  createTestChats,
  createTestChatScope,
  createTestEvents,
  createTestWidgetReferenceResolver,
  testAgentWorld,
} from './service.fixture';

function createService(): AgentService {
  const service = new AgentService({
    world: testAgentWorld(),
    dataPath: '/tmp/omnidraw-agent-settings-test',
    widgetDraftsRoot: '/tmp/omnidraw-agent-settings-test/widgets/drafts',
    eventPublisherService: createTestEvents(),
    chats: createTestChats(),
    chatScope: createTestChatScope(),
    widgetReferenceResolver: createTestWidgetReferenceResolver(),
  });
  service.modelRuntime = {
    async listCredentials() { return []; },
    getModels() { return []; },
    getAvailableSnapshot() { return []; },
  } as never;
  return service;
}

describe('AgentService settings projection', () => {
  test('omits absent optional defaults from the JSON transport value', async () => {
    const settings = await createService().settings();

    expect(settings).toEqual({
      providersWithCredentials: [],
      providers: [],
      models: [],
    });
    expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
  });
});

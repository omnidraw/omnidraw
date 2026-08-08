import { describe, expect, test } from 'bun:test';
import { oc, populateContractRouterPaths } from '@orpc/contract';
import { agentContract } from './contract';
import { agentHandlers } from './handlers';

function api() {
  return populateContractRouterPaths(
    oc.router({ api: oc.router({ agent: agentContract }) }),
  ).api.agent;
}

describe('agent contract', () => {
  test('contains chat/auth only and leaves widget authority under api.widget', () => {
    const contract = api() as unknown as Record<string, unknown>;
    expect(Object.keys(contract).sort()).toEqual([
      'approval',
      'auth',
      'chat',
      'events',
      'settings',
    ]);
    expect(Object.keys(agentHandlers).sort()).toEqual([
      'approval',
      'auth',
      'chat',
      'events',
      'settings',
    ]);
    expect(contract).not.toHaveProperty('widgets');
    expect(contract).not.toHaveProperty('widgetDraft');
    expect(contract).not.toHaveProperty('widgetPreview');
    expect(contract).not.toHaveProperty('widgetPublish');
  });

  test('accepts filesystem widget keys in chat mentions and rejects legacy names', () => {
    const schema = api().chat.prompt['~orpc'].inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const base = {
      widgetId: 'chat',
      sessionId: 'session',
      text: 'Inspect this widget',
    };
    expect(schema.safeParse({
      ...base,
      widgetRefs: [{ name: 'notes-board', source: 'draft' }],
    }).success).toBe(true);
    expect(schema.safeParse({
      ...base,
      widgetRefs: [{ name: 'Notes Board', source: 'draft' }],
    }).success).toBe(false);
  });

  test('requires opaque entry identity for chat edits', () => {
    const schema = api().chat.edit['~orpc'].inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const base = { widgetId: 'chat', sessionId: 'session', text: 'corrected' };
    expect(schema.safeParse({ ...base, entryId: 'pi-entry-id' }).success).toBe(true);
    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, entryId: '' }).success).toBe(false);
  });
});

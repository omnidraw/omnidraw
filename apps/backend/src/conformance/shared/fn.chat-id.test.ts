import { describe, expect, test } from 'bun:test';
import { fnChatStorageSegments, fnClassifyChatId, fnCreateChatId } from '#backend/core/agent/chat/fn.chat-id';

const UUID = 'cebc287c-52c5-4658-a3ff-6f968af1401e';

describe('chat identity', () => {
  test('accepts the frontend UUID identity and derives one direct storage layout', () => {
    expect(fnCreateChatId({ uuid: UUID.toUpperCase() })).toBe(UUID);
    expect(fnClassifyChatId(UUID)).toEqual({ kind: 'uuid', sessionId: UUID });
    expect(fnChatStorageSegments(UUID)).toMatchObject({
      chat: ['chats', UUID],
      history: ['chats', UUID, 'history'],
      workspace: ['chats', UUID, 'workspace'],
      metadata: ['chats', UUID, 'chat.json'],
    });
  });

  test.each([
    '2026-02-30T07-51-37-118Z--cebc287c-52c5-4658-a3ff-6f968af1401e',
    '2026-07-18T24-51-37-118Z--cebc287c-52c5-4658-a3ff-6f968af1401e',
    '2026-07-18T07-51-37-118Z--not-a-uuid',
    '2026-07-18T07-51-37-118Z--cebc287c-52c5-0658-a3ff-6f968af1401e',
    '../escape', 'nested/chat', 'historical-test-id', UUID.toUpperCase(),
  ])('rejects unsafe or malformed identity %s', (sessionId) => {
    expect(() => fnClassifyChatId(sessionId)).toThrow();
  });

  test('preserves distinct UUID entropy', () => {
    const first = fnCreateChatId({ uuid: UUID });
    const second = fnCreateChatId({ uuid: '8dcc46aa-f606-4d03-88cb-77cb17aa5c7e' });
    expect(first).not.toBe(second);
  });
});

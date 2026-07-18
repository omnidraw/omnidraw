import { describe, expect, test } from 'bun:test';
import { fnChatStorageSegments, fnClassifyChatId, fnCreateChatId } from '../src/chat/fn.chat-id';

const UUID = 'cebc287c-52c5-4658-a3ff-6f968af1401e';
const DATED_ID = `2026-07-18T07-51-37-118Z--${UUID}`;

describe('chat identity', () => {
  test('formats injected UTC time and randomness and derives direct dated paths', () => {
    expect(fnCreateChatId({ now: new Date('2026-07-18T07:51:37.118Z'), uuid: UUID })).toBe(DATED_ID);
    expect(fnClassifyChatId(DATED_ID)).toEqual({
      kind: 'dated', sessionId: DATED_ID, date: '2026-07-18', createdAt: '2026-07-18T07:51:37.118Z',
    });
    expect(fnChatStorageSegments(DATED_ID)).toMatchObject({
      chat: ['chats', '2026-07-18', DATED_ID],
      history: ['chats', '2026-07-18', DATED_ID, 'history'],
      workspace: ['chats', '2026-07-18', DATED_ID, 'workspace'],
      metadata: ['chats', '2026-07-18', DATED_ID, 'chat.json'],
    });
  });

  test('keeps safe legacy identity exact and routes it to the legacy bucket', () => {
    expect(fnChatStorageSegments('4464085d-66d8-4baf-bbab-2c8574e4bd2f')).toMatchObject({
      kind: 'legacy',
      chat: ['chats', 'legacy', '4464085d-66d8-4baf-bbab-2c8574e4bd2f'],
    });
    expect(fnChatStorageSegments('historical-test-id').workspace.at(-1)).toBe('workspace');
  });

  test.each([
    '2026-02-30T07-51-37-118Z--cebc287c-52c5-4658-a3ff-6f968af1401e',
    '2026-07-18T24-51-37-118Z--cebc287c-52c5-4658-a3ff-6f968af1401e',
    '2026-07-18T07-51-37-118Z--not-a-uuid',
    '2026-07-18T07-51-37-118Z--cebc287c-52c5-0658-a3ff-6f968af1401e',
    '../escape', 'nested/chat', 'nested\\chat', 'CON', 'name.', 'name ', ' leading', 'trailing ', 'bad:name',
  ])('rejects unsafe or malformed identity %s', (sessionId) => {
    expect(() => fnClassifyChatId(sessionId)).toThrow();
  });

  test('uses full UUID randomness for two creations in the same millisecond', () => {
    const now = new Date('2026-07-18T07:51:37.118Z');
    const first = fnCreateChatId({ now, uuid: UUID });
    const second = fnCreateChatId({ now, uuid: '8dcc46aa-f606-4d03-88cb-77cb17aa5c7e' });
    expect(first).not.toBe(second);
  });
});

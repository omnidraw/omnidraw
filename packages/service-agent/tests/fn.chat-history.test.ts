import { describe, expect, test } from 'bun:test';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import {
  fnFindEditableUserMessage,
  fnProjectActiveChatHistory,
} from '../src/fn.chat-history';

const userEntry = {
  type: 'message',
  id: 'user-1',
  parentId: null,
  timestamp: '2026-08-08T00:00:00.000Z',
  message: {
    role: 'user',
    timestamp: 1,
    content: [
      { type: 'text', text: 'original text' },
      { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
    ],
  },
} satisfies SessionEntry;

describe('active chat history functions', () => {
  test('projects stable entry IDs without exposing inactive siblings', () => {
    const inactive = { ...userEntry, id: 'inactive-user' } satisfies SessionEntry;
    const history = fnProjectActiveChatHistory([userEntry], (entry) => (
      entry.type === 'message' ? [entry.message] : []
    ));

    expect(history).toEqual([{ entryId: 'user-1', message: userEntry.message }]);
    expect(history.some((item) => item.entryId === inactive.id)).toBe(false);
  });

  test('validates active user entries and preserves their image parts', () => {
    expect(fnFindEditableUserMessage([userEntry], 'user-1')).toEqual({
      entryId: 'user-1',
      text: 'original text',
      images: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    });
    expect(fnFindEditableUserMessage([], 'user-1')).toBeUndefined();
    expect(fnFindEditableUserMessage([userEntry], 'foreign')).toBeUndefined();
  });
});

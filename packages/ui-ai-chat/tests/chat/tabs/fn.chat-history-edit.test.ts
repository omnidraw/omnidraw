import { describe, expect, it } from 'vitest';
import {
  fnChatMessageHasImage,
  fnGetEditableChatMessageText,
  fnReplaceChatHistoryTail,
} from '../../../src/chat/components/tabs/fn.chat-history-edit';

describe('chat history editing functions', () => {
  it('replaces the selected user text, keeps images, and removes the visible tail', () => {
    const history = [
      { entryId: 'u1', message: { role: 'user', content: 'first' } },
      { entryId: 'a1', message: { role: 'assistant', content: 'old answer' } },
      { entryId: 'u2', message: { role: 'user', content: [
        { type: 'text', text: 'duplicate' },
        { type: 'image', data: 'image', mimeType: 'image/png' },
      ] } },
      { entryId: 'a2', message: { role: 'assistant', content: 'abandoned' } },
    ];

    const result = fnReplaceChatHistoryTail(history, 'u2', 'corrected');
    expect(result).toHaveLength(3);
    expect(result?.[2]).toEqual({ entryId: 'u2', message: { role: 'user', content: [
      { type: 'text', text: 'corrected' },
      { type: 'image', data: 'image', mimeType: 'image/png' },
    ] } });
    expect(fnGetEditableChatMessageText(result?.[2]?.message)).toBe('corrected');
    expect(fnChatMessageHasImage(result?.[2]?.message)).toBe(true);
  });

  it('targets duplicate text by entry ID and rejects unknown IDs', () => {
    const history = [
      { entryId: 'first', message: { role: 'user', content: 'same' } },
      { entryId: 'second', message: { role: 'user', content: 'same' } },
    ];
    expect(fnReplaceChatHistoryTail(history, 'second', 'changed')?.[0]).toEqual(history[0]);
    expect(fnReplaceChatHistoryTail(history, 'missing', 'changed')).toBeUndefined();
  });
});

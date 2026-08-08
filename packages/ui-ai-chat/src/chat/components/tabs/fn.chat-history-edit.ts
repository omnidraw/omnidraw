export type TChatHistoryItem = {
  entryId?: string;
  message: unknown;
};

function fnObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

export function fnGetEditableChatMessageText(message: unknown): string {
  const content = fnObject(message)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => {
    const object = fnObject(part);
    return object?.type === 'text' && typeof object.text === 'string' ? [object.text] : [];
  }).join('');
}

export function fnChatMessageHasImage(message: unknown): boolean {
  const content = fnObject(message)?.content;
  return Array.isArray(content) && content.some((part) => {
    const type = fnObject(part)?.type;
    return typeof type === 'string' && type.toLowerCase().includes('image');
  });
}

export function fnReplaceChatHistoryTail(
  history: readonly TChatHistoryItem[],
  entryId: string,
  text: string,
): TChatHistoryItem[] | undefined {
  const index = history.findIndex((item) => item.entryId === entryId);
  if (index < 0) return undefined;
  const item = history[index];
  const message = fnObject(item?.message);
  if (!item || message?.role !== 'user') return undefined;

  const content = message.content;
  let nextContent: unknown = text;
  if (Array.isArray(content)) {
    let replacedText = false;
    nextContent = content.flatMap((part) => {
      const object = fnObject(part);
      if (object?.type !== 'text') return [part];
      if (replacedText || text.length === 0) return [];
      replacedText = true;
      return [{ ...object, text }];
    });
    if (!replacedText && text.length > 0) {
      nextContent = [{ type: 'text', text }, ...(nextContent as unknown[])];
    }
  }

  return [
    ...history.slice(0, index),
    { ...item, message: { ...message, content: nextContent } },
  ];
}

export type TChatIdClassification = Readonly<{
  kind: 'uuid';
  sessionId: string;
}>;

export type TChatStorageSegments = TChatIdClassification & Readonly<{
  chat: readonly string[];
  history: readonly string[];
  workspace: readonly string[];
  metadata: readonly string[];
}>;

const CHAT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** One clean-install identity: the canonical lowercase UUID created by the frontend. */
export function fnClassifyChatId(sessionId: string): TChatIdClassification {
  if (!CHAT_UUID_PATTERN.test(sessionId)) {
    throw new Error('Chat ID must be a canonical lowercase UUID.');
  }
  return { kind: 'uuid', sessionId };
}

export function fnCreateChatId(args: Readonly<{ uuid: string }>): string {
  const sessionId = args.uuid.toLocaleLowerCase('en-US');
  fnClassifyChatId(sessionId);
  return sessionId;
}

export function fnChatStorageSegments(sessionId: string): TChatStorageSegments {
  const classified = fnClassifyChatId(sessionId);
  const chat = ['chats', sessionId] as const;
  return {
    ...classified,
    chat,
    history: [...chat, 'history'],
    workspace: [...chat, 'workspace'],
    metadata: [...chat, 'chat.json'],
  };
}

import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';

type TAgentMessage = AgentSession['messages'][number];

export type TAgentChatHistoryItem = {
  entryId: string;
  message: TAgentMessage;
};

export type TEditableUserMessage = {
  entryId: string;
  images: Array<{
    type: 'image';
    data: string;
    mimeType: string;
  }>;
  text: string;
};

type TProjectEntry = (entry: SessionEntry) => TAgentMessage[];

export function fnProjectActiveChatHistory(
  entries: readonly SessionEntry[],
  projectEntry: TProjectEntry,
): TAgentChatHistoryItem[] {
  return entries.flatMap((entry) => projectEntry(entry).map((message) => ({
    entryId: entry.id,
    message,
  })));
}

export function fnFindEditableUserMessage(
  entries: readonly SessionEntry[],
  entryId: string,
): TEditableUserMessage | undefined {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (entry?.type !== 'message' || entry.message.role !== 'user') return undefined;

  if (typeof entry.message.content === 'string') {
    return { entryId, images: [], text: entry.message.content };
  }

  const text = entry.message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const images = entry.message.content
    .filter((part): part is Extract<typeof part, { type: 'image' }> => part.type === 'image')
    .map((part) => ({ ...part }));

  return { entryId, images, text };
}

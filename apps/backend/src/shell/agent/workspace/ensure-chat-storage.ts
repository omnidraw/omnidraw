import { fnChatStorageSegments } from '#backend/core/agent/chat/fn.chat-id';
import { readChatMetadata } from './read-chat-metadata';

export type TChatMetadata = {
  version: 1;
  sessionId: string;
};

export type TEffects = {
  join(...parts: string[]): string;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, content: string, options: { encoding: 'utf8'; flag: 'wx' }): Promise<unknown>;
};

export type TArgs = {
  agentRoot: string;
  sessionId: string;
};

function metadataFor(sessionId: string): TChatMetadata {
  fnChatStorageSegments(sessionId);
  return { version: 1, sessionId };
}

function assertMetadata(value: unknown, expected: TChatMetadata): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Chat metadata is invalid.');
  const actual = value as Partial<TChatMetadata>;
  if (
    actual.version !== expected.version
    || actual.sessionId !== expected.sessionId
  ) {
    throw new Error(`Chat metadata does not match directory identity '${expected.sessionId}'.`);
  }
}

export async function ensureChatStorage(effects: TEffects, args: TArgs): Promise<{
  root: string;
  history: string;
  workspace: string;
  metadata: TChatMetadata;
}> {
  const segments = fnChatStorageSegments(args.sessionId);
  const root = effects.join(args.agentRoot, ...segments.chat);
  const history = effects.join(args.agentRoot, ...segments.history);
  const workspace = effects.join(args.agentRoot, ...segments.workspace);
  const metadataPath = effects.join(args.agentRoot, ...segments.metadata);
  const metadata = metadataFor(args.sessionId);
  await effects.mkdir(history, { recursive: true });
  await effects.mkdir(effects.join(workspace, 'widgets'), { recursive: true });
  try {
    await effects.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
  }
  let stored: unknown;
  try {
    stored = await readChatMetadata({ readFile: effects.readFile }, { metadataPath });
  } catch {
    throw new Error(`Chat metadata is unreadable for '${args.sessionId}'.`);
  }
  assertMetadata(stored, metadata);
  return { root, history, workspace, metadata };
}

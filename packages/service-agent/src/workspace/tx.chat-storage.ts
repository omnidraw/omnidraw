import { fnChatStorageSegments } from '@vibecanvas/shared-functions/chat/fn.chat-id';
import { fxReadChatMetadata } from './fx.chat-metadata';

export type TChatMetadata = {
  version: 1;
  sessionId: string;
  legacy: boolean;
  createdAt?: string;
};

export type TPortal = {
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
  const classified = fnChatStorageSegments(sessionId);
  return classified.kind === 'dated'
    ? { version: 1, sessionId, createdAt: classified.createdAt, legacy: false }
    : { version: 1, sessionId, legacy: true };
}

function assertMetadata(value: unknown, expected: TChatMetadata): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Chat metadata is invalid.');
  const actual = value as Partial<TChatMetadata>;
  if (
    actual.version !== expected.version
    || actual.sessionId !== expected.sessionId
    || actual.legacy !== expected.legacy
    || actual.createdAt !== expected.createdAt
  ) {
    throw new Error(`Chat metadata does not match directory identity '${expected.sessionId}'.`);
  }
}

export async function txEnsureChatStorage(portal: TPortal, args: TArgs): Promise<{
  root: string;
  history: string;
  workspace: string;
  metadata: TChatMetadata;
}> {
  const segments = fnChatStorageSegments(args.sessionId);
  const root = portal.join(args.agentRoot, ...segments.chat);
  const history = portal.join(args.agentRoot, ...segments.history);
  const workspace = portal.join(args.agentRoot, ...segments.workspace);
  const metadataPath = portal.join(args.agentRoot, ...segments.metadata);
  const metadata = metadataFor(args.sessionId);
  await portal.mkdir(history, { recursive: true });
  await portal.mkdir(portal.join(workspace, 'widgets'), { recursive: true });
  try {
    await portal.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
  }
  let stored: unknown;
  try {
    stored = await fxReadChatMetadata({ readFile: portal.readFile }, { metadataPath });
  } catch {
    throw new Error(`Chat metadata is unreadable for '${args.sessionId}'.`);
  }
  assertMetadata(stored, metadata);
  return { root, history, workspace, metadata };
}

import { fnChatStorageSegments, fnClassifyChatId } from '@vibecanvas/shared-functions/chat/fn.chat-id';
import type { TMigrationPortal, TMigrationResult } from '../migration-types';

export const AGENT_STORAGE_MIGRATION_NAME = '014-migrate-agent-storage.ts';
export const AGENT_STORAGE_MIGRATION_VERSION = '1';

type TMount = { chatId: string; name: string; source: 'draft' | 'published' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOWS_NAMES = new Set(['con', 'prn', 'aux', 'nul', ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)]);

function isWidgetName(name: string): boolean {
  const stem = name.split('.', 1)[0]?.toLocaleLowerCase('en-US') ?? '';
  return name.length > 0 && name.length <= 120 && name === name.trim() && name !== '.' && name !== '..'
    && !/[\/\\<>:"|?*\u0000-\u001f\u007f]/.test(name) && !/[. ]$/.test(name) && !WINDOWS_NAMES.has(stem);
}

function chatPaths(portal: TMigrationPortal, chatId: string) {
  const agentRoot = portal.path.join(portal.dataDir, 'pi', 'agent');
  const segments = fnChatStorageSegments(chatId);
  return {
    root: portal.path.join(agentRoot, ...segments.chat),
    history: portal.path.join(agentRoot, ...segments.history),
    workspace: portal.path.join(agentRoot, ...segments.workspace),
    metadata: portal.path.join(agentRoot, ...segments.metadata),
    classified: segments,
  };
}

async function exists(portal: TMigrationPortal, candidate: string): Promise<boolean> {
  return Boolean(await portal.fs.lstat(candidate).catch(() => null));
}

async function directDirectories(portal: TMigrationPortal, root: string): Promise<string[]> {
  const entries = await portal.fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as { code?: unknown }).code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
}

function warningCollector() {
  const warnings: string[] = [];
  return {
    add(code: string, entry: string) {
      if (warnings.length >= 100) return;
      warnings.push(`${code}: ${entry.slice(0, 180)}`);
    },
    result(): TMigrationResult {
      return { warnings: warnings.length < 100 ? warnings : [...warnings.slice(0, 99), 'WARNING_LIMIT: additional entries were preserved'] };
    },
  };
}

async function moveDirectory(
  portal: TMigrationPortal,
  source: string,
  destination: string,
  label: string,
  warn: ReturnType<typeof warningCollector>,
): Promise<boolean> {
  const sourceStat = await portal.fs.lstat(source).catch(() => null);
  if (!sourceStat) return false;
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    warn.add('UNMANAGED_ENTRY', label);
    return false;
  }
  if (await exists(portal, destination)) {
    warn.add('DESTINATION_COLLISION', label);
    return false;
  }
  await portal.fs.mkdir(portal.path.dirname(destination), { recursive: true });
  await portal.fs.rename(source, destination);
  return true;
}

async function removeRootWhenEmpty(portal: TMigrationPortal, root: string): Promise<void> {
  const entries = await portal.fs.readdir(root).catch(() => null);
  if (entries?.length === 0) await portal.fs.rmdir(root).catch(() => undefined);
}

async function warnRemainingEntries(
  portal: TMigrationPortal,
  root: string,
  label: string,
  warn: ReturnType<typeof warningCollector>,
): Promise<void> {
  const entries = await portal.fs.readdir(root).catch(() => []);
  for (const entry of entries) warn.add('PRESERVED_UNKNOWN_ENTRY', `${label}/${entry}`);
}

async function ensureMetadata(portal: TMigrationPortal, chatId: string): Promise<void> {
  const paths = chatPaths(portal, chatId);
  await portal.fs.mkdir(paths.history, { recursive: true });
  await portal.fs.mkdir(portal.path.join(paths.workspace, 'widgets'), { recursive: true });
  const metadata = paths.classified.kind === 'dated'
    ? { version: 1, sessionId: chatId, createdAt: paths.classified.createdAt, legacy: false }
    : { version: 1, sessionId: chatId, legacy: true };
  try {
    await portal.fs.writeFile(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    const actual = JSON.parse(await portal.fs.readFile(paths.metadata, 'utf8')) as unknown;
    if (JSON.stringify(actual) !== JSON.stringify(metadata)) throw new Error(`Chat metadata collision for '${chatId}'.`);
  }
}

async function normalizeHistoryCwd(portal: TMigrationPortal, chatId: string): Promise<void> {
  const paths = chatPaths(portal, chatId);
  const entries = await portal.fs.readdir(paths.history, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const file = portal.path.join(paths.history, entry.name);
    const lines = (await portal.fs.readFile(file, 'utf8')).split('\n');
    let changed = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      try {
        const header = JSON.parse(line) as { type?: unknown; cwd?: unknown };
        if (header.type === 'session' && header.cwd !== paths.workspace) {
          lines[index] = JSON.stringify({ ...header, cwd: paths.workspace });
          changed = true;
        }
      } catch {
        break;
      }
      break;
    }
    if (!changed) continue;
    const temporary = `${file}.migration-014.tmp`;
    await portal.fs.writeFile(temporary, lines.join('\n'), 'utf8');
    try {
      await portal.fs.rename(temporary, file);
    } finally {
      await portal.fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

async function inspectDevelopmentMounts(
  portal: TMigrationPortal,
  chatCwdRoot: string,
  oldDraftRoot: string,
  oldPublishedRoot: string,
  warn: ReturnType<typeof warningCollector>,
): Promise<TMount[]> {
  const mounts: TMount[] = [];
  const resolvedDraftRoot = await portal.fs.realpath(oldDraftRoot).catch(() => oldDraftRoot);
  const resolvedPublishedRoot = await portal.fs.realpath(oldPublishedRoot).catch(() => oldPublishedRoot);
  const inspectWorkspace = async (chatId: string, workspace: string) => {
    const widgets = portal.path.join(workspace, 'widgets');
    const entries = await portal.fs.readdir(widgets, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isSymbolicLink() || !isWidgetName(entry.name)) continue;
      const mountPath = portal.path.join(widgets, entry.name);
      const target = await portal.fs.realpath(mountPath).catch(() => null);
      if (target === portal.path.join(resolvedDraftRoot, entry.name)) mounts.push({ chatId, name: entry.name, source: 'draft' });
      else if (target === portal.path.join(resolvedPublishedRoot, entry.name)) mounts.push({ chatId, name: entry.name, source: 'published' });
      else warn.add('UNOWNED_MOUNT', `${chatId}/widgets/${entry.name}`);
    }
  };
  for (const chatId of await directDirectories(portal, chatCwdRoot)) {
    try { fnClassifyChatId(chatId); } catch { warn.add('INVALID_CHAT_ID', chatId); continue; }
    await inspectWorkspace(chatId, portal.path.join(chatCwdRoot, chatId));
  }
  const sharedRoot = portal.path.join(portal.path.dirname(chatCwdRoot), 'shared-cwd');
  if (await exists(portal, sharedRoot)) {
    const knownChats = await directDirectories(portal, portal.path.join(portal.path.dirname(chatCwdRoot), 'sessions'));
    for (const chatId of knownChats) {
      try { fnClassifyChatId(chatId); await inspectWorkspace(chatId, sharedRoot); } catch { /* reported by session discovery */ }
    }
  }
  return mounts;
}

async function migrateNamedChildren(
  portal: TMigrationPortal,
  sourceRoot: string,
  destinationRoot: string,
  excluded: Set<string>,
  warn: ReturnType<typeof warningCollector>,
): Promise<void> {
  const entries = await portal.fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink() || !isWidgetName(entry.name)) {
      warn.add('PRESERVED_UNKNOWN_WIDGET_ENTRY', entry.name);
      continue;
    }
    await moveDirectory(portal, portal.path.join(sourceRoot, entry.name), portal.path.join(destinationRoot, entry.name), entry.name, warn);
  }
  await removeRootWhenEmpty(portal, sourceRoot);
}

async function recreateMounts(portal: TMigrationPortal, mounts: TMount[], warn: ReturnType<typeof warningCollector>): Promise<void> {
  const agentRoot = portal.path.join(portal.dataDir, 'pi', 'agent');
  const draftRoot = portal.path.join(agentRoot, 'widgets', 'drafts');
  const publishedRoot = portal.path.join(agentRoot, 'widgets', 'published');
  for (const mount of mounts) {
    const paths = chatPaths(portal, mount.chatId);
    const mountPath = portal.path.join(paths.workspace, 'widgets', mount.name);
    const draft = portal.path.join(draftRoot, mount.name);
    if (!await exists(portal, draft) && mount.source === 'published' && await exists(portal, portal.path.join(publishedRoot, mount.name))) {
      await portal.fs.cp(portal.path.join(publishedRoot, mount.name), draft, { recursive: true, dereference: true });
    }
    if (!await exists(portal, draft)) { warn.add('MOUNT_TARGET_MISSING', `${mount.chatId}/widgets/${mount.name}`); continue; }
    const entry = await portal.fs.lstat(mountPath).catch(() => null);
    if (entry?.isSymbolicLink()) await portal.fs.rm(mountPath, { force: true });
    else if (entry) { warn.add('MOUNT_COLLISION', `${mount.chatId}/widgets/${mount.name}`); continue; }
    const linkTarget = portal.platform === 'win32' ? draft : portal.path.relative(portal.path.dirname(mountPath), draft);
    await portal.fs.symlink(linkTarget, mountPath, portal.platform === 'win32' ? 'junction' : 'dir');
    if (await portal.fs.realpath(mountPath) !== await portal.fs.realpath(draft)) throw new Error(`Failed to verify migrated mount '${mount.name}'.`);
  }
}

export async function runAgentStorageMigration(portal: TMigrationPortal, _args: Record<string, never> = {}): Promise<TMigrationResult> {
  const warn = warningCollector();
  const agentRoot = portal.path.join(portal.dataDir, 'pi', 'agent');
  if (!await exists(portal, agentRoot)) return warn.result();
  const sessionsRoot = portal.path.join(agentRoot, 'sessions');
  const chatCwdRoot = portal.path.join(agentRoot, 'chat-cwd');
  const oldDraftRoot = portal.path.join(agentRoot, 'widget-drafts');
  const oldPublishedRoot = portal.path.join(agentRoot, 'widget-cwd');
  const sharedWorkspaceRoot = portal.path.join(agentRoot, 'shared-cwd');
  const newDraftRoot = portal.path.join(agentRoot, 'widgets', 'drafts');
  const newPublishedRoot = portal.path.join(agentRoot, 'widgets', 'published');
  await portal.fs.mkdir(newDraftRoot, { recursive: true });
  await portal.fs.mkdir(newPublishedRoot, { recursive: true });

  const sessionIds = new Set<string>();
  for (const root of [sessionsRoot, chatCwdRoot]) {
    for (const candidate of await directDirectories(portal, root)) {
      try { fnClassifyChatId(candidate); sessionIds.add(candidate); } catch { warn.add('INVALID_CHAT_ID', candidate); }
    }
  }
  const chatsRoot = portal.path.join(agentRoot, 'chats');
  for (const bucket of await directDirectories(portal, chatsRoot)) {
    if (bucket === 'legacy') {
      for (const candidate of await directDirectories(portal, portal.path.join(chatsRoot, bucket))) {
        try {
          if (fnClassifyChatId(candidate).kind !== 'legacy') throw new Error('dated ID in legacy bucket');
          sessionIds.add(candidate);
        } catch { warn.add('INVALID_MIGRATED_CHAT', `${bucket}/${candidate}`); }
      }
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bucket)) { warn.add('UNKNOWN_CHAT_BUCKET', bucket); continue; }
    for (const candidate of await directDirectories(portal, portal.path.join(chatsRoot, bucket))) {
      try {
        const classified = fnClassifyChatId(candidate);
        if (classified.kind !== 'dated' || classified.date !== bucket) throw new Error('date bucket mismatch');
        sessionIds.add(candidate);
      } catch { warn.add('INVALID_MIGRATED_CHAT', `${bucket}/${candidate}`); }
    }
  }
  const releasedWorkspaceEntries = new Map<string, string>();
  for (const entry of await directDirectories(portal, oldPublishedRoot)) {
    const matches = [...sessionIds].filter((chatId) => entry.endsWith(chatId) && UUID_PATTERN.test(entry.slice(0, -chatId.length)));
    if (matches.length === 1) releasedWorkspaceEntries.set(entry, matches[0]!);
  }
  const mounts = await inspectDevelopmentMounts(portal, chatCwdRoot, oldDraftRoot, oldPublishedRoot, warn);

  await migrateNamedChildren(portal, oldDraftRoot, newDraftRoot, new Set(), warn);
  await migrateNamedChildren(portal, oldPublishedRoot, newPublishedRoot, new Set(releasedWorkspaceEntries.keys()), warn);

  for (const chatId of sessionIds) {
    const paths = chatPaths(portal, chatId);
    await moveDirectory(portal, portal.path.join(sessionsRoot, chatId), paths.history, `sessions/${chatId}`, warn);
    await moveDirectory(portal, portal.path.join(chatCwdRoot, chatId), paths.workspace, `chat-cwd/${chatId}`, warn);
  }
  for (const [entry, chatId] of releasedWorkspaceEntries) {
    const paths = chatPaths(portal, chatId);
    await moveDirectory(portal, portal.path.join(oldPublishedRoot, entry), paths.workspace, `widget-cwd/${entry}`, warn);
  }
  if (await exists(portal, sharedWorkspaceRoot)) {
    const candidates: string[] = [];
    for (const chatId of sessionIds) {
      if (!await exists(portal, chatPaths(portal, chatId).workspace)) candidates.push(chatId);
    }
    if (candidates.length === 1) {
      await moveDirectory(portal, sharedWorkspaceRoot, chatPaths(portal, candidates[0]!).workspace, 'shared-cwd', warn);
    } else if (candidates.length > 1) {
      for (const chatId of candidates) {
        const destination = chatPaths(portal, chatId).workspace;
        if (await exists(portal, destination)) continue;
        await portal.fs.mkdir(portal.path.dirname(destination), { recursive: true });
        await portal.fs.cp(sharedWorkspaceRoot, destination, { recursive: true, dereference: false });
      }
      warn.add('SHARED_WORKSPACE_COPIED', `${candidates.length} legacy chats; source preserved`);
    } else {
      warn.add('PRESERVED_UNKNOWN_WORKSPACE', 'shared-cwd');
    }
  }
  await warnRemainingEntries(portal, sessionsRoot, 'sessions', warn);
  await warnRemainingEntries(portal, chatCwdRoot, 'chat-cwd', warn);
  await removeRootWhenEmpty(portal, sessionsRoot);
  await removeRootWhenEmpty(portal, chatCwdRoot);
  await removeRootWhenEmpty(portal, oldPublishedRoot);

  for (const chatId of sessionIds) {
    await ensureMetadata(portal, chatId);
    await normalizeHistoryCwd(portal, chatId);
  }
  await recreateMounts(portal, mounts, warn);
  return warn.result();
}

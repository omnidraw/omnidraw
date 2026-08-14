import { constants } from 'node:fs';
import {
  lstat,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type {
  TWidgetDeletionMount,
  TWidgetDeletionPlacement,
  TWidgetDeletionPlan,
  TWidgetDeletionResult,
  TWidgetDeletionSource,
} from '#backend/shell/agent';

const JOURNAL_SUFFIX = '.deletion.json';
const JOURNAL_MAX_BYTES = 8 * 1_024 * 1_024;
const WIDGET_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN = /^[A-Za-z0-9_-]{1,96}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const ZPlacement = z.object({
  canvasId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  itemRevision: z.number().int().positive(),
  createdAtSec: z.string().min(1).max(100),
  instanceId: z.string().min(1).max(200),
  type: z.enum(['widget-instance', 'widget-preview']),
}).strict();

const ZMount = z.object({
  chatId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  relativePath: z.string().min(1).max(1_024),
  linkTarget: z.string().min(1).max(2_048),
}).strict();

const ZPlan = z.object({
  planToken: z.string().regex(TOKEN),
  widgetKey: z.string().regex(WIDGET_KEY),
  source: z.enum(['draft', 'published']),
  catalogDigestSha256: z.string().regex(SHA256),
  pairedDraftPresent: z.boolean(),
  placementCount: z.number().int().nonnegative(),
  previewPlacementCount: z.number().int().nonnegative(),
  publishedPlacementCount: z.number().int().nonnegative(),
  chatMountCount: z.number().int().nonnegative(),
  resourcesPreserved: z.literal(true),
}).strict();

const ZResult = z.object({
  status: z.literal('committed'),
  operationId: z.string().regex(TOKEN),
  widgetKey: z.string().regex(WIDGET_KEY),
  source: z.enum(['draft', 'published']),
  generation: z.number().int().positive(),
  catalogDigestSha256: z.string().regex(SHA256),
  removedPlacementCount: z.number().int().nonnegative(),
  removedChatMountCount: z.number().int().nonnegative(),
  resourcesPreserved: z.literal(true),
}).strict();

const ZJournal = z.object({
  format: z.literal('omnidraw.widget-deletion.v1'),
  plan: ZPlan,
  operationId: z.string().regex(TOKEN),
  phase: z.enum(['prepared', 'sources-moved', 'cleanup', 'committed']),
  forms: z.array(z.object({
    source: z.enum(['draft', 'published']),
    relativePath: z.string().min(1).max(256),
    treeDigestSha256: z.string().regex(SHA256),
    trashName: z.string().min(1).max(320),
  }).strict()).min(1).max(2),
  placements: z.array(ZPlacement).max(20_000),
  mounts: z.array(ZMount).max(20_000),
  completedPlacementKeys: z.array(z.string().min(1).max(500)).max(20_000),
  completedMountPaths: z.array(z.string().min(1).max(1_024)).max(20_000),
  result: ZResult.nullable(),
}).strict();

export type TWidgetDeletionJournal = Readonly<{
  format: 'omnidraw.widget-deletion.v1';
  plan: TWidgetDeletionPlan;
  operationId: string;
  phase: 'prepared' | 'sources-moved' | 'cleanup' | 'committed';
  forms: readonly Readonly<{
    source: TWidgetDeletionSource;
    relativePath: string;
    treeDigestSha256: string;
    trashName: string;
  }>[];
  placements: readonly TWidgetDeletionPlacement[];
  mounts: readonly TWidgetDeletionMount[];
  completedPlacementKeys: readonly string[];
  completedMountPaths: readonly string[];
  result: TWidgetDeletionResult | null;
}>;

type TRootIdentity = Readonly<{ path: string; dev: number; ino: number }>;

function missing(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function errorWithCode(message: string, code: string, cause?: unknown): Error {
  return Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code },
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isDirectory()) throw new Error(`'${path}' is not a directory.`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function placementKey(placement: TWidgetDeletionPlacement): string {
  return `${placement.canvasId}\u0000${placement.itemId}\u0000${placement.createdAtSec}\u0000${placement.instanceId}`;
}

export class WidgetDeletionJournalStore {
  readonly #root: TRootIdentity;

  private constructor(root: TRootIdentity) {
    this.#root = root;
  }

  static async open(widgetRoot: string): Promise<WidgetDeletionJournalStore> {
    const path = await realpath(resolve(widgetRoot));
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw errorWithCode('Widget deletion root is not a direct directory.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
    for (const name of ['drafts', 'published', '.staging', '.trash']) {
      const child = join(path, name);
      const childStat = await lstat(child);
      if (!childStat.isDirectory() || childStat.isSymbolicLink()) {
        throw errorWithCode(
          `Widget deletion managed root '${name}' is unsafe.`,
          'WIDGET_DELETION_UNSAFE_PATH',
        );
      }
    }
    return new WidgetDeletionJournalStore({ path, dev: Number(stat.dev), ino: Number(stat.ino) });
  }

  journalPath(widgetKey: string, planToken: string): string {
    this.#assertKeyToken(widgetKey, planToken);
    return join(this.#root.path, '.staging', `${widgetKey}.${planToken}${JOURNAL_SUFFIX}`);
  }

  async list(): Promise<readonly TWidgetDeletionJournal[]> {
    await this.#assertRoot();
    const staging = join(this.#root.path, '.staging');
    const entries = await readdir(staging, { withFileTypes: true });
    const journals: TWidgetDeletionJournal[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.name.endsWith(JOURNAL_SUFFIX)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw errorWithCode('Widget deletion journal is not a direct file.', 'WIDGET_DELETION_RECOVERY_PENDING');
      }
      journals.push(await this.readPath(join(staging, entry.name)));
    }
    return Object.freeze(journals);
  }

  async read(widgetKey: string, planToken: string): Promise<TWidgetDeletionJournal | null> {
    const path = this.journalPath(widgetKey, planToken);
    try {
      return await this.readPath(path);
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async create(journal: TWidgetDeletionJournal): Promise<void> {
    const path = this.journalPath(journal.plan.widgetKey, journal.plan.planToken);
    const bytes = this.#serialize(journal);
    await this.#assertRoot();
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(dirname(path));
  }

  async update(journal: TWidgetDeletionJournal): Promise<void> {
    const path = this.journalPath(journal.plan.widgetKey, journal.plan.planToken);
    const temporary = `${path}.update-${journal.operationId}`;
    const bytes = this.#serialize(journal);
    await this.#assertRoot();
    const staleTemporary = await lstat(temporary).catch((error) => (
      missing(error) ? null : Promise.reject(error)
    ));
    if (staleTemporary !== null) {
      if (!staleTemporary.isFile() || staleTemporary.isSymbolicLink()) {
        throw errorWithCode(
          'Widget deletion journal update path is unsafe.',
          'WIDGET_DELETION_RECOVERY_PENDING',
        );
      }
      await rm(temporary, { force: false });
    }
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, path);
      await syncDirectory(dirname(path));
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async discardPrepared(journal: TWidgetDeletionJournal): Promise<void> {
    if (journal.phase !== 'prepared') {
      throw errorWithCode(
        'Only an unmutated deletion journal can be discarded.',
        'WIDGET_DELETION_RECOVERY_PENDING',
      );
    }
    const current = await this.read(journal.plan.widgetKey, journal.plan.planToken);
    if (current === null) return;
    if (current.operationId !== journal.operationId || current.phase !== 'prepared') {
      throw errorWithCode(
        'Widget deletion journal changed before discard.',
        'WIDGET_DELETION_RECOVERY_PENDING',
      );
    }
    await rm(this.journalPath(journal.plan.widgetKey, journal.plan.planToken), { force: false });
    await syncDirectory(join(this.#root.path, '.staging'));
  }

  async moveSource(args: Readonly<{
    widgetKey: string;
    planToken: string;
    source: TWidgetDeletionSource;
    relativePath: string;
    trashName: string;
  }>): Promise<'moved' | 'already-moved'> {
    this.#assertKeyToken(args.widgetKey, args.planToken);
    const rootName = args.source === 'draft' ? 'drafts' : 'published';
    const expectedRelative = `${rootName}/${args.widgetKey}`;
    if (args.relativePath !== expectedRelative || basename(args.trashName) !== args.trashName) {
      throw errorWithCode('Widget deletion source is not an exact direct child.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
    const source = join(this.#root.path, args.relativePath);
    const trash = join(this.#root.path, '.trash', args.trashName);
    await this.#assertRoot();
    const [sourceStat, trashStat] = await Promise.all([
      lstat(source).catch((error) => missing(error) ? null : Promise.reject(error)),
      lstat(trash).catch((error) => missing(error) ? null : Promise.reject(error)),
    ]);
    if (trashStat !== null) {
      if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) {
        throw errorWithCode('Widget deletion trash identity is unsafe.', 'WIDGET_DELETION_RECOVERY_PENDING');
      }
      return 'already-moved';
    }
    if (sourceStat === null || !sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      throw errorWithCode('Widget deletion source changed before it was moved.', 'WIDGET_DELETION_STALE_PLAN');
    }
    const [resolvedParent, expectedParent] = await Promise.all([
      realpath(dirname(source)),
      realpath(join(this.#root.path, rootName)),
    ]);
    if (resolvedParent !== expectedParent || dirname(await realpath(source)) !== expectedParent) {
      throw errorWithCode('Widget deletion source escaped its configured root.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
    await rename(source, trash);
    await Promise.all([syncDirectory(expectedParent), syncDirectory(join(this.#root.path, '.trash'))]);
    return 'moved';
  }

  async purgeTrash(trashName: string): Promise<void> {
    if (basename(trashName) !== trashName) {
      throw errorWithCode('Widget deletion trash name is unsafe.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
    const path = join(this.#root.path, '.trash', trashName);
    const stat = await lstat(path).catch((error) => missing(error) ? null : Promise.reject(error));
    if (stat === null) return;
    if (!stat.isDirectory() || stat.isSymbolicLink() || dirname(await realpath(path)) !== join(this.#root.path, '.trash')) {
      throw errorWithCode('Widget deletion trash path is unsafe.', 'WIDGET_DELETION_RECOVERY_PENDING');
    }
    await rm(path, { recursive: true, force: false });
    await syncDirectory(join(this.#root.path, '.trash'));
  }

  async trashExists(trashName: string): Promise<boolean> {
    if (basename(trashName) !== trashName) {
      throw errorWithCode('Widget deletion trash name is unsafe.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
    const stat = await lstat(join(this.#root.path, '.trash', trashName)).catch((error) => (
      missing(error) ? null : Promise.reject(error)
    ));
    if (stat === null) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw errorWithCode('Widget deletion trash identity is unsafe.', 'WIDGET_DELETION_RECOVERY_PENDING');
    }
    return true;
  }

  static placementKey = placementKey;

  async readPath(path: string): Promise<TWidgetDeletionJournal> {
    await this.#assertRoot();
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > JOURNAL_MAX_BYTES) {
      throw errorWithCode('Widget deletion journal is unsafe or too large.', 'WIDGET_DELETION_RECOVERY_PENDING');
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (Number(opened.dev) !== Number(stat.dev) || Number(opened.ino) !== Number(stat.ino)) {
        throw errorWithCode('Widget deletion journal changed while opening.', 'WIDGET_DELETION_RECOVERY_PENDING');
      }
      const parsed = ZJournal.safeParse(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
      if (!parsed.success) {
        throw errorWithCode('Widget deletion journal is invalid.', 'WIDGET_DELETION_RECOVERY_PENDING');
      }
      const journal = parsed.data as TWidgetDeletionJournal;
      const expectedName = `${journal.plan.widgetKey}.${journal.plan.planToken}${JOURNAL_SUFFIX}`;
      if (basename(path) !== expectedName) {
        throw errorWithCode('Widget deletion journal filename is inconsistent.', 'WIDGET_DELETION_RECOVERY_PENDING');
      }
      return Object.freeze(journal);
    } finally {
      await handle.close();
    }
  }

  #serialize(journal: TWidgetDeletionJournal): string {
    const parsed = ZJournal.parse(journal);
    const bytes = `${JSON.stringify(parsed)}\n`;
    if (Buffer.byteLength(bytes) > JOURNAL_MAX_BYTES) {
      throw errorWithCode('Widget deletion journal exceeds its durable bound.', 'WIDGET_DELETION_TOO_LARGE');
    }
    return bytes;
  }

  async #assertRoot(): Promise<void> {
    const stat = await lstat(this.#root.path);
    if (
      !stat.isDirectory()
      || stat.isSymbolicLink()
      || Number(stat.dev) !== this.#root.dev
      || Number(stat.ino) !== this.#root.ino
    ) throw errorWithCode('Widget deletion root identity changed.', 'WIDGET_DELETION_UNSAFE_PATH');
    const suffix = relative(this.#root.path, this.#root.path);
    if (suffix === '..' || suffix.startsWith(`..${sep}`)) {
      throw errorWithCode('Widget deletion root escaped.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
  }

  #assertKeyToken(widgetKey: string, token: string): void {
    if (!WIDGET_KEY.test(widgetKey) || !TOKEN.test(token)) {
      throw errorWithCode('Widget deletion identity is invalid.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
  }
}

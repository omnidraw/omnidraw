import { afterEach, describe, expect, test } from 'bun:test';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PublicationReadWriteBarrier,
  NodeWidgetPublicationFilesystem,
  fnIsPublicationSlug,
  fnSerializePublicationJournal,
  fnSerializePublicationWriterLock,
  fxReadPublicationWriterLock,
  txClearStalePublicationWriterLock,
  txAcquireWidgetRootWriterLease,
  txPublishAtomicPublication,
  txPublishWidgetMetadata,
  txRecoverAtomicPublications,
  type TAtomicPublicationInput,
  type TPublicationDigestFence,
  type TPublicationPortal,
  type TPublicationRecoveryJournal,
  type TPublicationTransitionEvent,
} from '../../src/widget-filesystem/publication';

const DRAFT_DIGEST = 'a'.repeat(64);
const CATALOG_DIGEST = 'b'.repeat(64);
const EXECUTABLE_DIGEST = 'c'.repeat(64);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type TTestPortal = TPublicationPortal & {
  fence: TPublicationDigestFence;
  readonly transitions: TPublicationTransitionEvent[];
  readonly writes: string[];
  failTransition: ((event: TPublicationTransitionEvent) => boolean) | null;
  pauseTransition: ((event: TPublicationTransitionEvent) => Promise<void>) | null;
  deviceOverride: ((path: string, device: number | bigint) => number | bigint) | null;
  rejectCurrentVersion: string | null;
  rejectManifestName: string | null;
};

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function jsonManifest(version: string, name = `Counter ${version}`, slug = 'counter'): string {
  return `${JSON.stringify({
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    slug,
    name,
    description: `Counter ${version}`,
    tool: { label: name, group: 'tests', priority: 0 },
    ui: { entry: 'ui/main.ts', apis: ['DOM'], budgets: {} },
  })}\n`;
}

function releaseJson(): string {
  return `${JSON.stringify({
    format: 'omnidraw.widget-release.v1',
    complete: true,
    executableManifestDigestSha256: EXECUTABLE_DIGEST,
    files: [
      { path: 'capsule.artifact', byteSize: 7, sha256: 'd'.repeat(64) },
      { path: 'dist/app.js', byteSize: 2, sha256: 'e'.repeat(64) },
    ],
    capsule: { path: 'capsule.artifact' },
    server: null,
  })}\n`;
}

function publicationInput(
  root: string,
  barrier: PublicationReadWriteBarrier,
  version: string,
  operationToken: string,
): TAtomicPublicationInput {
  return {
    widgetRoot: root,
    slug: 'counter',
    operationToken,
    lockOwnerToken: `owner-${operationToken}`,
    expectedFence: {
      draftDigestSha256: DRAFT_DIGEST,
      catalogDigestSha256: CATALOG_DIGEST,
    },
    manifestJson: jsonManifest(version),
    files: [
      { path: 'dist/app.js', bytes: version },
      { path: 'capsule.artifact', bytes: 'capsule' },
    ],
    releaseJson: releaseJson(),
    barrier,
  };
}

async function publicationVersion(path: string): Promise<string | null> {
  return readFile(join(path, 'dist', 'app.js'), 'utf8').catch(() => null);
}

async function validateFolder(
  slug: string,
  path: string,
  rejected: string | null,
  rejectedName: string | null = null,
) {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { valid: false as const, reason: 'unsafe' };
    const manifest = JSON.parse(await readFile(join(path, 'omnidraw.json'), 'utf8')) as {
      slug?: unknown;
      name?: unknown;
    };
    const release = JSON.parse(await readFile(join(path, 'release.json'), 'utf8')) as {
      format?: unknown;
      complete?: unknown;
    };
    const version = await publicationVersion(path);
    if (
      manifest.slug !== slug
      || manifest.name === rejectedName
      || release.format !== 'omnidraw.widget-release.v1'
      || release.complete !== true
      || version === null
      || rejected === version
    ) return { valid: false as const, reason: 'invalid test publication' };
    await lstat(join(path, 'capsule.artifact'));
    return { valid: true as const };
  } catch (error) {
    return { valid: false as const, reason: `${error}` };
  }
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-publication-'));
  roots.push(root);
  return root;
}

function createPortal(): TTestPortal {
  const transitions: TPublicationTransitionEvent[] = [];
  const writes: string[] = [];
  const portal: TTestPortal = {
    fence: {
      draftDigestSha256: DRAFT_DIGEST,
      catalogDigestSha256: CATALOG_DIGEST,
    },
    transitions,
    writes,
    failTransition: null,
    pauseTransition: null,
    deviceOverride: null,
    rejectCurrentVersion: null,
    rejectManifestName: null,
    join,
    async lstat(path) {
      const value = await lstat(path);
      const override = portal.deviceOverride?.(path, value.dev) ?? value.dev;
      return {
        dev: override,
        size: value.size,
        isDirectory: () => value.isDirectory(),
        isFile: () => value.isFile(),
        isSymbolicLink: () => value.isSymbolicLink(),
      };
    },
    readdir,
    readFile,
    async mkdir(path, options) {
      await mkdir(path, options);
    },
    async writeFile(path, bytes, options) {
      writes.push(path);
      await writeFile(path, bytes, options);
    },
    rename,
    async removeFileIfContentsMatch(path, expected) {
      const actual = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (actual === null) return 'missing';
      if (actual !== expected) return 'mismatch';
      await unlink(path);
      return 'removed';
    },
    syncFile: syncPath,
    syncDirectory: syncPath,
    async observeFence() {
      return portal.fence;
    },
    async validateReopenedPublication({ slug, path }) {
      return validateFolder(slug, path, portal.rejectCurrentVersion, portal.rejectManifestName);
    },
    async validateMetadataCandidate({ slug, currentPath, manifestJson, expectedExecutableManifestDigestSha256 }) {
      const manifest = JSON.parse(manifestJson) as { slug?: unknown };
      const release = JSON.parse(await readFile(join(currentPath, 'release.json'), 'utf8')) as {
        executableManifestDigestSha256?: unknown;
      };
      return manifest.slug === slug
        && release.executableManifestDigestSha256 === expectedExecutableManifestDigestSha256
        ? { valid: true }
        : { valid: false, reason: 'metadata candidate mismatch' };
    },
    async onTransition(event) {
      expect(Object.isFrozen(event)).toBe(true);
      transitions.push(event);
      if (portal.pauseTransition?.(event)) await portal.pauseTransition(event);
      if (portal.failTransition?.(event)) throw new Error(`Injected ${event.timing}:${event.transition}`);
    },
  };
  return portal;
}

describe('atomic filesystem widget publication', () => {
  test('uses the manifest-v1 100-byte ASCII slug bound', () => {
    expect(fnIsPublicationSlug('a'.repeat(100))).toBe(true);
    expect(fnIsPublicationSlug('a'.repeat(101))).toBe(false);
  });

  test('writes release.json last, syncs, reopens, and atomically installs one complete folder', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    const result = await txPublishAtomicPublication(
      portal,
      publicationInput(root, barrier, 'v1', 'publish-v1'),
    );

    expect(result).toEqual({
      status: 'committed',
      slug: 'counter',
      operationToken: 'publish-v1',
      currentPath: join(root, 'published', 'counter'),
      replacedPath: null,
    });
    expect(await publicationVersion(result.currentPath)).toBe('v1');
    expect(await fxReadPublicationWriterLock(portal, { widgetRoot: root })).toBeNull();
    const stageWrites = portal.writes.filter((path) => path.includes('.stage/'));
    expect(stageWrites.at(-1)).toEndWith('/release.json');
    expect(portal.transitions.filter((event) => event.transition === 'stage-reopen-validation')).toHaveLength(2);
    expect(portal.transitions.filter((event) => event.transition === 'current-reopen-validation')).toHaveLength(2);
    expect(await readdir(join(root, 'published'))).toEqual(['counter']);
  });

  test('holds an in-process reader across the two-rename gap and exposes only the new folder', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', 'publish-v1'));

    let releasePause!: () => void;
    const paused = new Promise<void>((resolve) => {
      portal.pauseTransition = async (event) => {
        if (event.timing !== 'after' || event.transition !== 'current-to-trash') return;
        resolve();
        await new Promise<void>((next) => {
          releasePause = next;
        });
      };
    });
    const publishing = txPublishAtomicPublication(
      portal,
      publicationInput(root, barrier, 'v2', 'publish-v2'),
    );
    await paused;
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBeNull();

    let readerEntered = false;
    const reading = barrier.withRead(async () => {
      readerEntered = true;
      return publicationVersion(join(root, 'published', 'counter'));
    });
    await Promise.resolve();
    expect(readerEntered).toBe(false);
    releasePause();
    await publishing;
    expect(await reading).toBe('v2');
    expect(await publicationVersion(join(root, '.trash', 'counter.publish-v2.replaced'))).toBe('v1');
  });

  test('rechecks draft and catalog digests immediately before replacement', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', 'publish-v1'));
    portal.failTransition = null;
    portal.pauseTransition = async (event) => {
      if (event.timing === 'after' && event.transition === 'stage-reopen-validation') {
        portal.fence = { ...portal.fence, draftDigestSha256: 'f'.repeat(64) };
      }
    };

    await expect(txPublishAtomicPublication(
      portal,
      publicationInput(root, barrier, 'v2', 'fenced-v2'),
    )).rejects.toMatchObject({ code: 'PUBLICATION_FENCE_CONFLICT' });
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBe('v1');
    expect(await publicationVersion(join(root, '.staging', 'counter.fenced-v2.stage'))).toBe('v2');
  });

  test('rejects a stage whose observed device differs from the pinned widget root', async () => {
    const root = await createRoot();
    const portal = createPortal();
    portal.deviceOverride = (path, device) => path.endsWith('.stage') ? Number(device) + 1 : device;
    await expect(txPublishAtomicPublication(
      portal,
      publicationInput(root, new PublicationReadWriteBarrier(), 'v1', 'cross-device'),
    )).rejects.toMatchObject({ code: 'CROSS_DEVICE_STAGE' });
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBeNull();
    expect(await lstat(join(root, '.staging', 'counter.cross-device.stage'))).toBeTruthy();
  });

  test('allows only one concurrent cross-process-style wx writer lock', async () => {
    const root = await createRoot();
    const portal = createPortal();
    let releasePause!: () => void;
    const acquired = new Promise<void>((resolve) => {
      portal.pauseTransition = async (event) => {
        if (event.timing !== 'after' || event.transition !== 'lock-create' || event.operationToken !== 'writer-one') return;
        resolve();
        await new Promise<void>((next) => {
          releasePause = next;
        });
      };
    });
    const first = txPublishAtomicPublication(
      portal,
      publicationInput(root, new PublicationReadWriteBarrier(), 'v1', 'writer-one'),
    );
    await acquired;
    await expect(txPublishAtomicPublication(
      portal,
      publicationInput(root, new PublicationReadWriteBarrier(), 'v2', 'writer-two'),
    )).rejects.toMatchObject({ code: 'WRITER_LOCK_HELD' });
    releasePause();
    await first;
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBe('v1');
  });

  test('preserves an earlier root-barrier poison across an unrelated successful publication', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    const priorGap = Object.assign(new Error('another widget has an unresolved gap'), {
      code: 'PUBLICATION_PATH_GAP',
    });
    barrier.poison(priorGap);
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', 'other-widget'));
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBe('v1');
    expect(barrier.isPoisoned()).toBe(true);
    await expect(barrier.withRead(() => 'entered')).rejects.toBe(priorGap);
  });

  test('runs through the production confined no-follow Node portal adapter', async () => {
    const requestedRoot = await createRoot();
    const transitions: TPublicationTransitionEvent[] = [];
    const filesystem = await NodeWidgetPublicationFilesystem.create({
      widgetRoot: requestedRoot,
      hooks: {
        async observeFence() {
          return {
            draftDigestSha256: DRAFT_DIGEST,
            catalogDigestSha256: CATALOG_DIGEST,
          };
        },
        async validateReopenedPublication({ slug, path }) {
          return validateFolder(slug, path, null);
        },
        async validateMetadataCandidate({ slug, currentPath, manifestJson, expectedExecutableManifestDigestSha256 }) {
          const manifest = JSON.parse(manifestJson) as { slug?: unknown };
          const release = JSON.parse(await readFile(join(currentPath, 'release.json'), 'utf8')) as {
            executableManifestDigestSha256?: unknown;
          };
          return manifest.slug === slug
            && release.executableManifestDigestSha256 === expectedExecutableManifestDigestSha256
            ? { valid: true }
            : { valid: false, reason: 'invalid metadata candidate' };
        },
        async onTransition(event) {
          transitions.push(event);
        },
      },
    });
    const result = await txPublishAtomicPublication(
      filesystem,
      publicationInput(
        filesystem.rootPath,
        new PublicationReadWriteBarrier(),
        'v1',
        'node-adapter',
      ),
    );
    expect(await publicationVersion(result.currentPath)).toBe('v1');
    expect(transitions.some((event) => event.transition === 'stage-to-current')).toBe(true);
    await expect(filesystem.lstat(join(filesystem.rootPath, '..', 'escape'))).rejects.toThrow('escapes');
  });

  test('production compare-remove atomically claims the old lease and never unlinks a raced replacement', async () => {
    const requestedRoot = await createRoot();
    const replacement = fnSerializePublicationWriterLock('raced-owner', 'import');
    let injectRace = true;
    const filesystem = await NodeWidgetPublicationFilesystem.create({
      widgetRoot: requestedRoot,
      hooks: {
        async observeFence() {
          return { draftDigestSha256: DRAFT_DIGEST, catalogDigestSha256: CATALOG_DIGEST };
        },
        async validateReopenedPublication({ slug, path }) {
          return validateFolder(slug, path, null);
        },
        async validateMetadataCandidate() {
          return { valid: true };
        },
        async onCompareRemoveClaimed({ path }) {
          if (!injectRace || !path.endsWith('.writer.lock')) return;
          injectRace = false;
          await writeFile(path, replacement, { flag: 'wx', mode: 0o600 });
        },
      },
    });
    const lease = await txAcquireWidgetRootWriterLease(filesystem, {
      widgetRoot: filesystem.rootPath,
      operationToken: 'old-lease',
      ownerToken: 'old-owner',
      purpose: 'preview',
    });
    await lease.release();
    const raced = await fxReadPublicationWriterLock(filesystem, {
      widgetRoot: filesystem.rootPath,
    });
    expect(raced?.serialized).toBe(replacement);
    expect(raced?.record.ownerToken).toBe('raced-owner');
    await txClearStalePublicationWriterLock(filesystem, {
      widgetRoot: filesystem.rootPath,
      operationToken: 'clear-raced',
      expectedSerializedLock: replacement,
      confirmation: 'explicitly-confirmed-no-live-writer',
    });
  });

  test('production adapter rejects a symlink requested as the widget root', async () => {
    const parent = await createRoot();
    const directRoot = join(parent, 'direct');
    const linkedRoot = join(parent, 'linked');
    await mkdir(directRoot);
    await symlink(directRoot, linkedRoot, 'dir');
    await expect(NodeWidgetPublicationFilesystem.create({
      widgetRoot: linkedRoot,
      hooks: {
        async observeFence() {
          return { draftDigestSha256: DRAFT_DIGEST, catalogDigestSha256: CATALOG_DIGEST };
        },
        async validateReopenedPublication() {
          return { valid: true };
        },
        async validateMetadataCandidate() {
          return { valid: true };
        },
      },
    })).rejects.toThrow('symlinked lexical ancestor');
  });

  test('never guesses stale locks from PID or age and clears only exact explicitly confirmed bytes', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const serialized = fnSerializePublicationWriterLock('dead-owner', 'publish');
    await writeFile(join(root, '.writer.lock'), serialized, { flag: 'wx', mode: 0o600 });
    const observed = await fxReadPublicationWriterLock(portal, { widgetRoot: root });
    expect(observed?.record).toEqual({
      format: 'omnidraw.widget-writer-lock.v1',
      ownerToken: 'dead-owner',
      purpose: 'publish',
    });
    expect(observed?.serialized).not.toContain('pid');
    expect(observed?.serialized).not.toContain('time');

    await expect(txClearStalePublicationWriterLock(portal, {
      widgetRoot: root,
      operationToken: 'clear-stale',
      expectedSerializedLock: `${serialized}changed`,
      confirmation: 'explicitly-confirmed-no-live-writer',
    })).rejects.toMatchObject({ code: 'STALE_LOCK_CHANGED' });
    expect(await fxReadPublicationWriterLock(portal, { widgetRoot: root })).not.toBeNull();
    await txClearStalePublicationWriterLock(portal, {
      widgetRoot: root,
      operationToken: 'clear-stale',
      expectedSerializedLock: serialized,
      confirmation: 'explicitly-confirmed-no-live-writer',
    });
    expect(await fxReadPublicationWriterLock(portal, { widgetRoot: root })).toBeNull();
  });

  test('shares the exact root writer lease protocol with import and Preview mutations', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const lease = await txAcquireWidgetRootWriterLease(portal, {
      widgetRoot: root,
      operationToken: 'preview-prepare',
      ownerToken: 'preview-owner',
      purpose: 'preview',
    });
    expect((await fxReadPublicationWriterLock(portal, { widgetRoot: root }))?.record).toEqual({
      format: 'omnidraw.widget-writer-lock.v1',
      ownerToken: 'preview-owner',
      purpose: 'preview',
    });
    await expect(txPublishAtomicPublication(
      portal,
      publicationInput(root, new PublicationReadWriteBarrier(), 'v1', 'blocked-publish'),
    )).rejects.toMatchObject({ code: 'WRITER_LOCK_HELD' });
    await lease.release();
    expect(await fxReadPublicationWriterLock(portal, { widgetRoot: root })).toBeNull();
    await txPublishAtomicPublication(
      portal,
      publicationInput(root, new PublicationReadWriteBarrier(), 'v1', 'after-preview'),
    );
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBe('v1');
  });

  test('faults around critical transitions never expose a partial current folder', async () => {
    const faultPoints = [
      'stage-file-write',
      'release-write',
      'journal-write',
      'current-to-trash',
      'stage-to-current',
      'journal-remove',
    ] as const;
    for (const [index, transition] of faultPoints.entries()) {
      const root = await createRoot();
      const portal = createPortal();
      const barrier = new PublicationReadWriteBarrier();
      await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', `base-${index}`));
      let injected = false;
      portal.failTransition = (event) => {
        if (!injected && event.operationToken === `fault-${index}` && event.timing === 'after' && event.transition === transition) {
          injected = true;
          return true;
        }
        return false;
      };
      await expect(txPublishAtomicPublication(
        portal,
        publicationInput(root, barrier, 'v2', `fault-${index}`),
      )).rejects.toThrow('Injected');
      const current = await publicationVersion(join(root, 'published', 'counter'));
      expect(current).not.toBeNull();
      if (current === null) throw new Error('Fault exposed a missing current publication.');
      expect(['v1', 'v2']).toContain(current);
      expect((await validateFolder('counter', join(root, 'published', 'counter'), null)).valid).toBe(true);
    }
  });
});

describe('publication restart recovery', () => {
  test('restores exactly one validated replaced folder and never promotes the staged replacement', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const oldBarrier = new PublicationReadWriteBarrier();
    await txPublishAtomicPublication(portal, publicationInput(root, oldBarrier, 'v1', 'base-v1'));
    let failedOldMove = false;
    let failedRollback = false;
    portal.failTransition = (event) => {
      if (!failedOldMove && event.operationToken === 'crash-v2' && event.timing === 'after' && event.transition === 'current-to-trash') {
        failedOldMove = true;
        return true;
      }
      if (!failedRollback && event.operationToken === 'crash-v2' && event.timing === 'before' && event.transition === 'trash-to-current') {
        failedRollback = true;
        return true;
      }
      return false;
    };
    await expect(txPublishAtomicPublication(
      portal,
      publicationInput(root, oldBarrier, 'v2', 'crash-v2'),
    )).rejects.toMatchObject({ code: 'PUBLICATION_PATH_GAP' });
    expect(oldBarrier.isPoisoned()).toBe(true);
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBeNull();
    expect(await publicationVersion(join(root, '.staging', 'counter.crash-v2.stage'))).toBe('v2');
    expect(await publicationVersion(join(root, '.trash', 'counter.crash-v2.replaced'))).toBe('v1');

    portal.failTransition = null;
    const recovery = await txRecoverAtomicPublications(portal, {
      widgetRoot: root,
      operationToken: 'restart-one',
      lockOwnerToken: 'recovery-owner',
      barrier: oldBarrier,
    });
    expect(recovery.entries).toEqual([expect.objectContaining({
      slug: 'counter',
      status: 'restored',
    })]);
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBe('v1');
    expect(await publicationVersion(join(root, '.staging', 'counter.crash-v2.stage'))).toBe('v2');
    expect(oldBarrier.isPoisoned()).toBe(false);
    expect(await oldBarrier.withRead(() => publicationVersion(
      join(root, 'published', 'counter'),
    ))).toBe('v1');
  });

  test('quarantines an invalid interrupted current and restores its one validated predecessor', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', 'base-v1'));
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v2', 'interrupted-v2'));
    const journal: TPublicationRecoveryJournal = {
      format: 'omnidraw.widget-replacement.v1',
      slug: 'counter',
      operationToken: 'interrupted-v2',
      stageName: 'counter.interrupted-v2.stage',
      replacedName: 'counter.interrupted-v2.replaced',
    };
    await writeFile(
      join(root, '.staging', 'counter.interrupted-v2.replacement.json'),
      fnSerializePublicationJournal(journal),
    );
    portal.rejectCurrentVersion = 'v2';

    const recovery = await txRecoverAtomicPublications(portal, {
      widgetRoot: root,
      operationToken: 'recover-invalid-current',
      lockOwnerToken: 'recover-invalid-owner',
      barrier,
    });
    expect(recovery.entries).toEqual([expect.objectContaining({
      slug: 'counter',
      status: 'restored',
      restoredPath: join(root, '.trash', 'counter.interrupted-v2.replaced'),
    })]);
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBe('v1');
    expect(await publicationVersion(
      join(root, '.quarantine', 'counter.recover-invalid-current.invalid-current'),
    )).toBe('v2');
    expect(barrier.isPoisoned()).toBe(false);
  });

  test('poisons readers when an invalid interrupted current cannot be quarantined', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', 'base-v1'));
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v2', 'interrupted-v2'));
    const journal: TPublicationRecoveryJournal = {
      format: 'omnidraw.widget-replacement.v1',
      slug: 'counter',
      operationToken: 'interrupted-v2',
      stageName: 'counter.interrupted-v2.stage',
      replacedName: 'counter.interrupted-v2.replaced',
    };
    await writeFile(
      join(root, '.staging', 'counter.interrupted-v2.replacement.json'),
      fnSerializePublicationJournal(journal),
    );
    portal.rejectCurrentVersion = 'v2';
    portal.failTransition = (event) => (
      event.operationToken === 'failed-quarantine'
      && event.timing === 'before'
      && event.transition === 'current-to-quarantine'
    );
    await expect(txRecoverAtomicPublications(portal, {
      widgetRoot: root,
      operationToken: 'failed-quarantine',
      lockOwnerToken: 'failed-quarantine-owner',
      barrier,
    })).rejects.toMatchObject({ code: 'PUBLICATION_PATH_GAP' });
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBe('v2');
    expect(barrier.isPoisoned('counter')).toBe(true);
    await expect(barrier.withRead(() => 'entered')).rejects.toMatchObject({
      code: 'PUBLICATION_PATH_GAP',
    });
  });

  test('reports ambiguity and leaves every candidate quarantinable rather than guessing', async () => {
    const root = await createRoot();
    const portal = createPortal();
    await txPublishAtomicPublication(
      portal,
      publicationInput(root, new PublicationReadWriteBarrier(), 'v1', 'base-v1'),
    );
    const trashRoot = join(root, '.trash');
    const stagingRoot = join(root, '.staging');
    const firstJournal: TPublicationRecoveryJournal = {
      format: 'omnidraw.widget-replacement.v1',
      slug: 'counter',
      operationToken: 'lost-one',
      stageName: 'counter.lost-one.stage',
      replacedName: 'counter.lost-one.replaced',
    };
    const secondJournal: TPublicationRecoveryJournal = {
      ...firstJournal,
      operationToken: 'lost-two',
      stageName: 'counter.lost-two.stage',
      replacedName: 'counter.lost-two.replaced',
    };
    await rename(join(root, 'published', 'counter'), join(trashRoot, firstJournal.replacedName));
    await cp(join(trashRoot, firstJournal.replacedName), join(trashRoot, secondJournal.replacedName), { recursive: true });
    await writeFile(
      join(stagingRoot, 'counter.lost-one.replacement.json'),
      fnSerializePublicationJournal(firstJournal),
    );
    await writeFile(
      join(stagingRoot, 'counter.lost-two.replacement.json'),
      fnSerializePublicationJournal(secondJournal),
    );
    const barrier = new PublicationReadWriteBarrier();
    const recovery = await txRecoverAtomicPublications(portal, {
      widgetRoot: root,
      operationToken: 'restart-ambiguous',
      lockOwnerToken: 'recovery-owner',
      barrier,
    });
    expect(recovery.entries).toEqual([expect.objectContaining({
      slug: 'counter',
      status: 'ambiguous',
      candidatePaths: [
        join(trashRoot, firstJournal.replacedName),
        join(trashRoot, secondJournal.replacedName),
      ],
    })]);
    expect(await publicationVersion(join(root, 'published', 'counter'))).toBeNull();
    expect(barrier.isPoisoned()).toBe(true);
    let entered = false;
    await expect(barrier.withRead(() => {
      entered = true;
      return null;
    })).rejects.toMatchObject({ code: 'PUBLICATION_PATH_GAP' });
    expect(entered).toBe(false);
  });
});

describe('checked metadata-only publication', () => {
  test('atomically replaces only omnidraw.json and retains every executable byte', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', 'base-v1'));
    const currentPath = join(root, 'published', 'counter');
    const runtimePaths = ['dist/app.js', 'capsule.artifact', 'release.json'];
    const before = await Promise.all(runtimePaths.map((path) => readFile(join(currentPath, path))));
    const writeIndex = portal.writes.length;

    const result = await txPublishWidgetMetadata(portal, {
      widgetRoot: root,
      slug: 'counter',
      operationToken: 'metadata-v2',
      lockOwnerToken: 'metadata-owner',
      expectedFence: portal.fence,
      expectedExecutableManifestDigestSha256: EXECUTABLE_DIGEST,
      newExecutableManifestDigestSha256: EXECUTABLE_DIGEST,
      manifestJson: jsonManifest('v1', 'Renamed Counter'),
      barrier,
    });
    const after = await Promise.all(runtimePaths.map((path) => readFile(join(currentPath, path))));
    expect(result.status).toBe('metadata-committed');
    expect(JSON.parse(await readFile(join(currentPath, 'omnidraw.json'), 'utf8'))).toMatchObject({
      name: 'Renamed Counter',
    });
    expect(after).toEqual(before);
    const metadataWrites = portal.writes.slice(writeIndex).filter((path) => !path.endsWith('.writer.lock'));
    expect(metadataWrites).toEqual([join(root, '.staging', 'counter.metadata-v2.metadata.json')]);

    await expect(txPublishWidgetMetadata(portal, {
      widgetRoot: root,
      slug: 'counter',
      operationToken: 'metadata-code-change',
      lockOwnerToken: 'metadata-owner-two',
      expectedFence: portal.fence,
      expectedExecutableManifestDigestSha256: EXECUTABLE_DIGEST,
      newExecutableManifestDigestSha256: 'f'.repeat(64),
      manifestJson: jsonManifest('v1', 'Forbidden executable edit'),
      barrier,
    })).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_INPUT' });
    expect(await Promise.all(runtimePaths.map((path) => readFile(join(currentPath, path))))).toEqual(before);
  });

  test('poisons readers when an invalid metadata replacement cannot roll back', async () => {
    const root = await createRoot();
    const portal = createPortal();
    const barrier = new PublicationReadWriteBarrier();
    await txPublishAtomicPublication(portal, publicationInput(root, barrier, 'v1', 'base-v1'));
    portal.rejectManifestName = 'Bad Metadata';
    let rollbackFaulted = false;
    portal.failTransition = (event) => {
      if (
        !rollbackFaulted
        && event.operationToken === 'bad-metadata'
        && event.timing === 'before'
        && event.transition === 'metadata-rollback-to-current'
      ) {
        rollbackFaulted = true;
        return true;
      }
      return false;
    };
    await expect(txPublishWidgetMetadata(portal, {
      widgetRoot: root,
      slug: 'counter',
      operationToken: 'bad-metadata',
      lockOwnerToken: 'bad-metadata-owner',
      expectedFence: portal.fence,
      expectedExecutableManifestDigestSha256: EXECUTABLE_DIGEST,
      newExecutableManifestDigestSha256: EXECUTABLE_DIGEST,
      manifestJson: jsonManifest('v1', 'Bad Metadata'),
      barrier,
    })).rejects.toMatchObject({ code: 'PUBLICATION_PATH_GAP' });
    expect(barrier.isPoisoned()).toBe(true);
    let readerEntered = false;
    await expect(barrier.withRead(() => {
      readerEntered = true;
      return readFile(join(root, 'published', 'counter', 'omnidraw.json'), 'utf8');
    })).rejects.toMatchObject({ code: 'PUBLICATION_PATH_GAP' });
    expect(readerEntered).toBe(false);
  });
});

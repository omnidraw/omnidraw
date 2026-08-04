import {
  PUBLICATION_DIRECTORY_MODE,
  PUBLICATION_FILE_MODE,
  PUBLICATION_LOCK_FILE,
  PUBLICATION_MANAGED_DIRECTORIES,
  PUBLICATION_MANIFEST_FILE,
  PUBLICATION_RELEASE_FILE,
  PUBLICATION_RECOVERY_SCAN_SCOPE,
} from './CONSTANTS';
import {
  fnCreatePublicationTransitionEvent,
  fnIsAlreadyPresentFilesystemError,
  fnIsMissingFilesystemError,
  fnIsPublicationToken,
  fnPublicationFenceMatches,
  fnPublicationJournalName,
  fnPublicationStageName,
  fnPublicationTrashName,
  fnReleaseExecutableManifestDigest,
  fnSerializePublicationJournal,
  fnSerializePublicationWriterLock,
  fnValidateAtomicPublicationInput,
  fnValidateMetadataPublicationInput,
} from './fn.publication';
import { fxScanPublicationRecoveryJournals } from './fx.publication';
import type {
  TAtomicPublicationInput,
  TAtomicPublicationResult,
  TAcquireWidgetRootWriterLeaseInput,
  TClearStaleWriterLockInput,
  TMetadataPublicationInput,
  TMetadataPublicationResult,
  TPublicationErrorCode,
  TPublicationFileStat,
  TPublicationPortal,
  TPublicationRecoveryEntry,
  TPublicationRecoveryJournal,
  TPublicationRecoveryJournalObservation,
  TPublicationRecoveryResult,
  TPublicationTransition,
  TPublicationWriterLockPurpose,
  TRecoverPublicationsInput,
  TWidgetRootWriterLease,
} from './typed';

type TPortal = TPublicationPortal;
type TArgsPublish = TAtomicPublicationInput;
type TArgsRecover = TRecoverPublicationsInput;
type TArgsClearStaleLock = TClearStaleWriterLockInput;
type TArgsMetadata = TMetadataPublicationInput;
type TArgsAcquireLease = TAcquireWidgetRootWriterLeaseInput;

type TTransitionContext = Readonly<{
  slug: string;
  operationToken: string;
}>;

type TPublicationPaths = Readonly<{
  publishedRoot: string;
  stagingRoot: string;
  trashRoot: string;
  quarantineRoot: string;
  currentPath: string;
  stagePath: string;
  replacedPath: string;
  journalPath: string;
}>;

function errorWithCode(
  code: TPublicationErrorCode,
  message: string,
  cause?: unknown,
): Error & { code: TPublicationErrorCode } {
  const error = new Error(message, cause === undefined ? undefined : { cause }) as Error & {
    code: TPublicationErrorCode;
  };
  error.code = code;
  return error;
}

async function checkpoint(
  portal: TPortal,
  context: TTransitionContext,
  timing: 'before' | 'after',
  transition: TPublicationTransition,
  path: string | null,
): Promise<void> {
  await portal.onTransition(fnCreatePublicationTransitionEvent({
    timing,
    transition,
    slug: context.slug,
    operationToken: context.operationToken,
    path,
  }));
}

async function mutate<T>(
  portal: TPortal,
  context: TTransitionContext,
  transition: TPublicationTransition,
  path: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  await checkpoint(portal, context, 'before', transition, path);
  const result = await operation();
  await checkpoint(portal, context, 'after', transition, path);
  return result;
}

async function statOrNull(portal: TPortal, path: string): Promise<TPublicationFileStat | null> {
  try {
    return await portal.lstat(path);
  } catch (error) {
    if (fnIsMissingFilesystemError(error)) return null;
    throw error;
  }
}

function deviceKey(stat: TPublicationFileStat): string {
  return `${stat.dev}`;
}

function assertDirectDirectory(path: string, stat: TPublicationFileStat): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw errorWithCode(
      'UNSAFE_PUBLICATION_PATH',
      `Publication path '${path}' must be a direct directory.`,
    );
  }
}

async function assertMissing(portal: TPortal, path: string): Promise<void> {
  if (await statOrNull(portal, path) !== null) {
    throw errorWithCode(
      'UNSAFE_PUBLICATION_PATH',
      `Publication destination '${path}' already exists.`,
    );
  }
}

async function syncFile(
  portal: TPortal,
  context: TTransitionContext,
  path: string,
): Promise<void> {
  await mutate(portal, context, 'file-sync', path, () => portal.syncFile(path));
}

async function syncDirectory(
  portal: TPortal,
  context: TTransitionContext,
  path: string,
): Promise<void> {
  await mutate(portal, context, 'directory-sync', path, () => portal.syncDirectory(path));
}

async function ensureManagedDirectories(
  portal: TPortal,
  context: TTransitionContext,
  widgetRoot: string,
): Promise<Readonly<{ rootStat: TPublicationFileStat; paths: readonly string[] }>> {
  const rootStat = await portal.lstat(widgetRoot);
  assertDirectDirectory(widgetRoot, rootStat);
  const paths: string[] = [];
  for (const name of PUBLICATION_MANAGED_DIRECTORIES) {
    const path = portal.join(widgetRoot, name);
    try {
      await mutate(portal, context, 'directory-create', path, () => portal.mkdir(path, {
        recursive: false,
        mode: PUBLICATION_DIRECTORY_MODE,
      }));
    } catch (error) {
      if (!fnIsAlreadyPresentFilesystemError(error)) throw error;
    }
    const stat = await portal.lstat(path);
    assertDirectDirectory(path, stat);
    if (deviceKey(stat) !== deviceKey(rootStat)) {
      throw errorWithCode(
        'CROSS_DEVICE_STAGE',
        `Managed publication directory '${path}' is on another filesystem.`,
      );
    }
    paths.push(path);
  }
  return Object.freeze({ rootStat, paths: Object.freeze(paths) });
}

function publicationPaths(
  portal: TPortal,
  widgetRoot: string,
  slug: string,
  operationToken: string,
): TPublicationPaths {
  const publishedRoot = portal.join(widgetRoot, 'published');
  const stagingRoot = portal.join(widgetRoot, '.staging');
  const trashRoot = portal.join(widgetRoot, '.trash');
  const quarantineRoot = portal.join(widgetRoot, '.quarantine');
  return Object.freeze({
    publishedRoot,
    stagingRoot,
    trashRoot,
    quarantineRoot,
    currentPath: portal.join(publishedRoot, slug),
    stagePath: portal.join(stagingRoot, fnPublicationStageName(slug, operationToken)),
    replacedPath: portal.join(trashRoot, fnPublicationTrashName(slug, operationToken)),
    journalPath: portal.join(stagingRoot, fnPublicationJournalName(slug, operationToken)),
  });
}

async function acquireWriterLock(
  portal: TPortal,
  context: TTransitionContext,
  widgetRoot: string,
  ownerToken: string,
  purpose: TPublicationWriterLockPurpose,
): Promise<string> {
  const lockPath = portal.join(widgetRoot, PUBLICATION_LOCK_FILE);
  const serialized = fnSerializePublicationWriterLock(ownerToken, purpose);
  try {
    await mutate(portal, context, 'lock-create', lockPath, () => portal.writeFile(
      lockPath,
      serialized,
      { flag: 'wx', mode: PUBLICATION_FILE_MODE },
    ));
  } catch (error) {
    if (fnIsAlreadyPresentFilesystemError(error)) {
      throw errorWithCode(
        'WRITER_LOCK_HELD',
        'The widget root already has a writer. Clear a stale lock only after explicit confirmation.',
        error,
      );
    }
    throw error;
  }
  await syncFile(portal, context, lockPath);
  await syncDirectory(portal, context, widgetRoot);
  return serialized;
}

async function releaseWriterLock(
  portal: TPortal,
  context: TTransitionContext,
  widgetRoot: string,
  serialized: string,
): Promise<void> {
  const lockPath = portal.join(widgetRoot, PUBLICATION_LOCK_FILE);
  const result = await mutate(
    portal,
    context,
    'lock-remove',
    lockPath,
    () => portal.removeFileIfContentsMatch(lockPath, serialized, context.operationToken),
  );
  if (result !== 'removed') {
    throw errorWithCode(
      'WRITER_LOCK_LOST',
      result === 'missing'
        ? 'The widget writer lock disappeared before release.'
        : 'The widget writer lock changed before release.',
    );
  }
  await syncDirectory(portal, context, widgetRoot);
}

async function assertFence(
  portal: TPortal,
  args: Readonly<{
    slug: string;
    expectedFence: TAtomicPublicationInput['expectedFence'];
  }>,
): Promise<void> {
  const observed = await portal.observeFence({ slug: args.slug });
  if (!fnPublicationFenceMatches(args.expectedFence, observed)) {
    throw errorWithCode(
      'PUBLICATION_FENCE_CONFLICT',
      `Widget '${args.slug}' changed after the publication input was captured.`,
    );
  }
}

async function validateReopened(
  portal: TPortal,
  context: TTransitionContext,
  transition: 'stage-reopen-validation' | 'replaced-reopen-validation' | 'current-reopen-validation',
  path: string,
): Promise<void> {
  await checkpoint(portal, context, 'before', transition, path);
  const validation = await portal.validateReopenedPublication({ slug: context.slug, path });
  await checkpoint(portal, context, 'after', transition, path);
  if (!validation.valid) {
    throw errorWithCode(
      'PUBLICATION_VALIDATION_FAILED',
      `Reopened widget publication '${path}' is invalid: ${validation.reason}`,
    );
  }
}

async function createAndSyncStage(
  portal: TPortal,
  args: TAtomicPublicationInput,
  context: TTransitionContext,
  paths: TPublicationPaths,
  rootStat: TPublicationFileStat,
  input: Extract<ReturnType<typeof fnValidateAtomicPublicationInput>, { valid: true }>,
): Promise<void> {
  await assertMissing(portal, paths.stagePath);
  await mutate(portal, context, 'directory-create', paths.stagePath, () => portal.mkdir(
    paths.stagePath,
    { recursive: false, mode: PUBLICATION_DIRECTORY_MODE },
  ));
  const stageStat = await portal.lstat(paths.stagePath);
  assertDirectDirectory(paths.stagePath, stageStat);
  if (deviceKey(stageStat) !== deviceKey(rootStat)) {
    throw errorWithCode('CROSS_DEVICE_STAGE', 'Publication stage is not on the widget-root filesystem.');
  }
  await syncDirectory(portal, context, paths.stagingRoot);

  for (const directory of input.directories) {
    const path = portal.join(paths.stagePath, ...directory.split('/'));
    await mutate(portal, context, 'directory-create', path, () => portal.mkdir(path, {
      recursive: false,
      mode: PUBLICATION_DIRECTORY_MODE,
    }));
  }

  const manifestPath = portal.join(paths.stagePath, PUBLICATION_MANIFEST_FILE);
  await mutate(portal, context, 'stage-file-write', manifestPath, () => portal.writeFile(
    manifestPath,
    args.manifestJson,
    { flag: 'wx', mode: PUBLICATION_FILE_MODE },
  ));
  for (const file of input.files) {
    const path = portal.join(paths.stagePath, ...file.path.split('/'));
    await mutate(portal, context, 'stage-file-write', path, () => portal.writeFile(
      path,
      file.bytes,
      { flag: 'wx', mode: PUBLICATION_FILE_MODE },
    ));
  }

  await syncFile(portal, context, manifestPath);
  for (const file of input.files) {
    await syncFile(portal, context, portal.join(paths.stagePath, ...file.path.split('/')));
  }
  for (const directory of [...input.directories].reverse()) {
    await syncDirectory(portal, context, portal.join(paths.stagePath, ...directory.split('/')));
  }
  await syncDirectory(portal, context, paths.stagePath);

  const releasePath = portal.join(paths.stagePath, PUBLICATION_RELEASE_FILE);
  await mutate(portal, context, 'release-write', releasePath, () => portal.writeFile(
    releasePath,
    args.releaseJson,
    { flag: 'wx', mode: PUBLICATION_FILE_MODE },
  ));
  await syncFile(portal, context, releasePath);
  await syncDirectory(portal, context, paths.stagePath);
  await syncDirectory(portal, context, paths.stagingRoot);
}

async function removeJournal(
  portal: TPortal,
  context: TTransitionContext,
  journalPath: string,
  serialized: string,
  stagingRoot: string,
): Promise<void> {
  const result = await mutate(
    portal,
    context,
    'journal-remove',
    journalPath,
    () => portal.removeFileIfContentsMatch(journalPath, serialized, context.operationToken),
  );
  if (result === 'mismatch') {
    throw errorWithCode('UNSAFE_PUBLICATION_PATH', `Recovery journal '${journalPath}' changed.`);
  }
  if (result === 'removed') await syncDirectory(portal, context, stagingRoot);
}

async function writeJournal(
  portal: TPortal,
  context: TTransitionContext,
  paths: TPublicationPaths,
): Promise<string> {
  const journal: TPublicationRecoveryJournal = Object.freeze({
    format: 'omnidraw.widget-replacement.v1',
    slug: context.slug,
    operationToken: context.operationToken,
    stageName: fnPublicationStageName(context.slug, context.operationToken),
    replacedName: fnPublicationTrashName(context.slug, context.operationToken),
  });
  const serialized = fnSerializePublicationJournal(journal);
  await assertMissing(portal, paths.journalPath);
  await mutate(portal, context, 'journal-write', paths.journalPath, () => portal.writeFile(
    paths.journalPath,
    serialized,
    { flag: 'wx', mode: PUBLICATION_FILE_MODE },
  ));
  await syncFile(portal, context, paths.journalPath);
  await syncDirectory(portal, context, paths.stagingRoot);
  return serialized;
}

async function restoreReplacedPublication(
  portal: TPortal,
  context: TTransitionContext,
  paths: TPublicationPaths,
  journalSerialized: string,
): Promise<void> {
  await validateReopened(portal, context, 'replaced-reopen-validation', paths.replacedPath);
  await assertMissing(portal, paths.currentPath);
  await checkpoint(portal, context, 'before', 'trash-to-current', paths.currentPath);
  await portal.rename(paths.replacedPath, paths.currentPath);
  await checkpoint(portal, context, 'after', 'trash-to-current', paths.currentPath);
  await syncDirectory(portal, context, paths.trashRoot);
  await syncDirectory(portal, context, paths.publishedRoot);
  await validateReopened(portal, context, 'current-reopen-validation', paths.currentPath);
  await removeJournal(
    portal,
    context,
    paths.journalPath,
    journalSerialized,
    paths.stagingRoot,
  );
}

async function publishInsideBarrier(
  portal: TPortal,
  args: TAtomicPublicationInput,
  input: Extract<ReturnType<typeof fnValidateAtomicPublicationInput>, { valid: true }>,
): Promise<TAtomicPublicationResult> {
  const context: TTransitionContext = Object.freeze({
    slug: args.slug,
    operationToken: args.operationToken,
  });
  const managed = await ensureManagedDirectories(portal, context, args.widgetRoot);
  const paths = publicationPaths(portal, args.widgetRoot, args.slug, args.operationToken);
  await assertFence(portal, args);
  await createAndSyncStage(portal, args, context, paths, managed.rootStat, input);
  await validateReopened(portal, context, 'stage-reopen-validation', paths.stagePath);
  await assertFence(portal, args);

  const currentStat = await statOrNull(portal, paths.currentPath);
  if (currentStat !== null) {
    assertDirectDirectory(paths.currentPath, currentStat);
    if (deviceKey(currentStat) !== deviceKey(managed.rootStat)) {
      throw errorWithCode('CROSS_DEVICE_STAGE', 'Current publication is on another filesystem.');
    }
  }
  await assertMissing(portal, paths.replacedPath);

  let journalSerialized: string | null = null;
  let oldMoved = false;
  let stageMoved = false;
  try {
    if (currentStat !== null) {
      journalSerialized = await writeJournal(portal, context, paths);
      await checkpoint(portal, context, 'before', 'current-to-trash', paths.replacedPath);
      await portal.rename(paths.currentPath, paths.replacedPath);
      oldMoved = true;
      await checkpoint(portal, context, 'after', 'current-to-trash', paths.replacedPath);
      await syncDirectory(portal, context, paths.publishedRoot);
      await syncDirectory(portal, context, paths.trashRoot);
    }

    await assertMissing(portal, paths.currentPath);
    await checkpoint(portal, context, 'before', 'stage-to-current', paths.currentPath);
    await portal.rename(paths.stagePath, paths.currentPath);
    stageMoved = true;
    await checkpoint(portal, context, 'after', 'stage-to-current', paths.currentPath);
    await syncDirectory(portal, context, paths.stagingRoot);
    await syncDirectory(portal, context, paths.publishedRoot);

    try {
      await validateReopened(portal, context, 'current-reopen-validation', paths.currentPath);
    } catch (validationError) {
      const quarantinePath = portal.join(
        paths.quarantineRoot,
        `${args.slug}.${args.operationToken}.failed-current`,
      );
      await assertMissing(portal, quarantinePath);
      await checkpoint(portal, context, 'before', 'current-to-quarantine', quarantinePath);
      await portal.rename(paths.currentPath, quarantinePath);
      stageMoved = false;
      await checkpoint(portal, context, 'after', 'current-to-quarantine', quarantinePath);
      await syncDirectory(portal, context, paths.publishedRoot);
      await syncDirectory(portal, context, paths.quarantineRoot);
      if (oldMoved && journalSerialized !== null) {
        await restoreReplacedPublication(portal, context, paths, journalSerialized);
        oldMoved = false;
        args.barrier.repair(args.slug);
      } else {
        args.barrier.poison(errorWithCode(
          'PUBLICATION_PATH_GAP',
          `First publication for '${args.slug}' failed reopened validation.`,
          validationError,
        ), args.slug);
      }
      throw validationError;
    }

    if (journalSerialized !== null) {
      await removeJournal(
        portal,
        context,
        paths.journalPath,
        journalSerialized,
        paths.stagingRoot,
      );
    }
    args.barrier.repair(args.slug);
    return Object.freeze({
      status: 'committed',
      slug: args.slug,
      operationToken: args.operationToken,
      currentPath: paths.currentPath,
      replacedPath: currentStat === null ? null : paths.replacedPath,
    });
  } catch (error) {
    if (oldMoved && !stageMoved && journalSerialized !== null) {
      try {
        await restoreReplacedPublication(portal, context, paths, journalSerialized);
        oldMoved = false;
        args.barrier.repair(args.slug);
      } catch (recoveryError) {
        const gapError = errorWithCode(
          'PUBLICATION_PATH_GAP',
          `Widget '${args.slug}' could not restore its replaced publication.`,
          recoveryError,
        );
        args.barrier.poison(gapError, args.slug);
        throw gapError;
      }
    }
    throw error;
  }
}

export async function txPublishAtomicPublication(
  portal: TPortal,
  args: TArgsPublish,
): Promise<TAtomicPublicationResult> {
  const input = fnValidateAtomicPublicationInput(args);
  if (!input.valid) {
    throw errorWithCode('INVALID_PUBLICATION_INPUT', input.reason);
  }
  const context: TTransitionContext = Object.freeze({
    slug: args.slug,
    operationToken: args.operationToken,
  });
  const rootStat = await portal.lstat(args.widgetRoot);
  assertDirectDirectory(args.widgetRoot, rootStat);
  const serializedLock = await acquireWriterLock(
    portal,
    context,
    args.widgetRoot,
    args.lockOwnerToken,
    'publish',
  );
  let operationError: unknown;
  try {
    return await args.barrier.withWrite(() => publishInsideBarrier(portal, args, input));
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseWriterLock(portal, context, args.widgetRoot, serializedLock);
    } catch (releaseError) {
      if (operationError === undefined) throw releaseError;
      throw errorWithCode(
        'WRITER_LOCK_LOST',
        'Publication failed and its writer lock could not be safely released.',
        { operationError, releaseError },
      );
    }
  }
}

async function readCurrentExecutableDigest(
  portal: TPortal,
  currentPath: string,
): Promise<string> {
  const releasePath = portal.join(currentPath, PUBLICATION_RELEASE_FILE);
  const releaseStat = await portal.lstat(releasePath);
  if (
    !releaseStat.isFile()
    || releaseStat.isSymbolicLink()
    || releaseStat.size > 1_048_576
  ) {
    throw errorWithCode(
      'PUBLICATION_VALIDATION_FAILED',
      `Current release descriptor '${releasePath}' is not a bounded direct file.`,
    );
  }
  const digest = fnReleaseExecutableManifestDigest(await portal.readFile(releasePath, 'utf8'));
  if (digest === null) {
    throw errorWithCode(
      'PUBLICATION_VALIDATION_FAILED',
      `Current release descriptor '${releasePath}' has no valid executable digest.`,
    );
  }
  return digest;
}

async function metadataInsideBarrier(
  portal: TPortal,
  args: TMetadataPublicationInput,
): Promise<TMetadataPublicationResult> {
  const context: TTransitionContext = Object.freeze({
    slug: args.slug,
    operationToken: args.operationToken,
  });
  const managed = await ensureManagedDirectories(portal, context, args.widgetRoot);
  const publishedRoot = portal.join(args.widgetRoot, 'published');
  const stagingRoot = portal.join(args.widgetRoot, '.staging');
  const currentPath = portal.join(publishedRoot, args.slug);
  const manifestPath = portal.join(currentPath, PUBLICATION_MANIFEST_FILE);
  const temporaryPath = portal.join(
    stagingRoot,
    `${args.slug}.${args.operationToken}.metadata.json`,
  );
  const rollbackPath = portal.join(
    stagingRoot,
    `${args.slug}.${args.operationToken}.metadata-rollback.json`,
  );

  const currentStat = await portal.lstat(currentPath);
  assertDirectDirectory(currentPath, currentStat);
  if (deviceKey(currentStat) !== deviceKey(managed.rootStat)) {
    throw errorWithCode('CROSS_DEVICE_STAGE', 'Current publication is on another filesystem.');
  }
  await validateReopened(portal, context, 'current-reopen-validation', currentPath);
  await assertFence(portal, args);
  const currentExecutableDigest = await readCurrentExecutableDigest(portal, currentPath);
  if (
    currentExecutableDigest !== args.expectedExecutableManifestDigestSha256
    || currentExecutableDigest !== args.newExecutableManifestDigestSha256
  ) {
    throw errorWithCode(
      'PUBLICATION_FENCE_CONFLICT',
      `Widget '${args.slug}' executable identity changed; metadata-only publication is fenced.`,
    );
  }
  await checkpoint(portal, context, 'before', 'metadata-reopen-validation', currentPath);
  const candidateValidation = await portal.validateMetadataCandidate({
    slug: args.slug,
    currentPath,
    manifestJson: args.manifestJson,
    expectedExecutableManifestDigestSha256: currentExecutableDigest,
  });
  await checkpoint(portal, context, 'after', 'metadata-reopen-validation', currentPath);
  if (!candidateValidation.valid) {
    throw errorWithCode(
      'PUBLICATION_VALIDATION_FAILED',
      `Metadata candidate for '${args.slug}' is invalid: ${candidateValidation.reason}`,
    );
  }

  const oldManifestStat = await portal.lstat(manifestPath);
  if (
    !oldManifestStat.isFile()
    || oldManifestStat.isSymbolicLink()
    || oldManifestStat.size > 1_048_576
  ) throw errorWithCode('UNSAFE_PUBLICATION_PATH', 'Current omnidraw.json is not a bounded direct file.');
  const oldManifestJson = await portal.readFile(manifestPath, 'utf8');

  await assertMissing(portal, temporaryPath);
  await mutate(portal, context, 'metadata-file-write', temporaryPath, () => portal.writeFile(
    temporaryPath,
    args.manifestJson,
    { flag: 'wx', mode: PUBLICATION_FILE_MODE },
  ));
  await syncFile(portal, context, temporaryPath);
  await syncDirectory(portal, context, stagingRoot);
  await assertFence(portal, args);
  if (await readCurrentExecutableDigest(portal, currentPath) !== currentExecutableDigest) {
    throw errorWithCode(
      'PUBLICATION_FENCE_CONFLICT',
      `Widget '${args.slug}' release changed before metadata replacement.`,
    );
  }

  await checkpoint(portal, context, 'before', 'metadata-to-current', manifestPath);
  await portal.rename(temporaryPath, manifestPath);
  await checkpoint(portal, context, 'after', 'metadata-to-current', manifestPath);
  await syncDirectory(portal, context, stagingRoot);
  await syncFile(portal, context, manifestPath);
  await syncDirectory(portal, context, currentPath);
  try {
    await validateReopened(portal, context, 'current-reopen-validation', currentPath);
  } catch (validationError) {
    try {
      await assertMissing(portal, rollbackPath);
      await mutate(portal, context, 'metadata-file-write', rollbackPath, () => portal.writeFile(
        rollbackPath,
        oldManifestJson,
        { flag: 'wx', mode: PUBLICATION_FILE_MODE },
      ));
      await syncFile(portal, context, rollbackPath);
      await syncDirectory(portal, context, stagingRoot);
      await checkpoint(portal, context, 'before', 'metadata-rollback-to-current', manifestPath);
      await portal.rename(rollbackPath, manifestPath);
      await checkpoint(portal, context, 'after', 'metadata-rollback-to-current', manifestPath);
      await syncDirectory(portal, context, stagingRoot);
      await syncFile(portal, context, manifestPath);
      await syncDirectory(portal, context, currentPath);
      await validateReopened(portal, context, 'current-reopen-validation', currentPath);
    } catch (rollbackError) {
      const gapError = errorWithCode(
        'PUBLICATION_PATH_GAP',
        `Widget '${args.slug}' metadata rollback could not restore a validated manifest.`,
        rollbackError,
      );
      args.barrier.poison(gapError, args.slug);
      throw gapError;
    }
    throw validationError;
  }
  args.barrier.repair(args.slug);
  return Object.freeze({
    status: 'metadata-committed',
    slug: args.slug,
    operationToken: args.operationToken,
    currentPath,
    manifestPath,
  });
}

export async function txPublishWidgetMetadata(
  portal: TPortal,
  args: TArgsMetadata,
): Promise<TMetadataPublicationResult> {
  const invalidReason = fnValidateMetadataPublicationInput(args);
  if (invalidReason !== null) {
    throw errorWithCode('INVALID_PUBLICATION_INPUT', invalidReason);
  }
  const context: TTransitionContext = Object.freeze({
    slug: args.slug,
    operationToken: args.operationToken,
  });
  const rootStat = await portal.lstat(args.widgetRoot);
  assertDirectDirectory(args.widgetRoot, rootStat);
  const serializedLock = await acquireWriterLock(
    portal,
    context,
    args.widgetRoot,
    args.lockOwnerToken,
    'metadata',
  );
  let operationError: unknown;
  try {
    return await args.barrier.withWrite(() => metadataInsideBarrier(portal, args));
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseWriterLock(portal, context, args.widgetRoot, serializedLock);
    } catch (releaseError) {
      if (operationError === undefined) throw releaseError;
      throw errorWithCode(
        'WRITER_LOCK_LOST',
        'Metadata publication failed and its writer lock could not be safely released.',
        { operationError, releaseError },
      );
    }
  }
}

async function validateRecoveryCandidate(
  portal: TPortal,
  context: TTransitionContext,
  path: string,
  rootStat: TPublicationFileStat,
): Promise<boolean> {
  const stat = await statOrNull(portal, path);
  if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) return false;
  if (deviceKey(stat) !== deviceKey(rootStat)) return false;
  try {
    await validateReopened(portal, context, 'replaced-reopen-validation', path);
    return true;
  } catch {
    return false;
  }
}

async function removeRecoveryJournals(
  portal: TPortal,
  context: TTransitionContext,
  stagingRoot: string,
  journals: readonly TPublicationRecoveryJournalObservation[],
): Promise<void> {
  for (const observation of journals) {
    await removeJournal(
      portal,
      context,
      observation.path,
      observation.serialized,
      stagingRoot,
    );
  }
}

async function recoverInsideBarrier(
  portal: TPortal,
  args: TRecoverPublicationsInput,
): Promise<TPublicationRecoveryResult> {
  const rootContext: TTransitionContext = Object.freeze({
    slug: '*',
    operationToken: args.operationToken,
  });
  const managed = await ensureManagedDirectories(portal, rootContext, args.widgetRoot);
  const stagingRoot = portal.join(args.widgetRoot, '.staging');
  const publishedRoot = portal.join(args.widgetRoot, 'published');
  const trashRoot = portal.join(args.widgetRoot, '.trash');
  const quarantineRoot = portal.join(args.widgetRoot, '.quarantine');
  const scan = await fxScanPublicationRecoveryJournals(portal, { widgetRoot: args.widgetRoot });
  const grouped = new Map<string, TPublicationRecoveryJournalObservation[]>();
  for (const observation of scan.journals) {
    const group = grouped.get(observation.journal.slug) ?? [];
    group.push(observation);
    grouped.set(observation.journal.slug, group);
  }
  const entries: TPublicationRecoveryEntry[] = [];

  for (const slug of [...grouped.keys()].sort()) {
    const journals = grouped.get(slug)!;
    const context: TTransitionContext = Object.freeze({ slug, operationToken: args.operationToken });
    const currentPath = portal.join(publishedRoot, slug);
    const candidates = new Map<string, TPublicationRecoveryJournalObservation>();
    for (const journal of journals) {
      const candidatePath = portal.join(trashRoot, journal.journal.replacedName);
      candidates.set(candidatePath, journal);
    }
    const candidatePaths = Object.freeze([...candidates.keys()].sort());
    const validCandidates: string[] = [];
    for (const candidatePath of candidatePaths) {
      if (await validateRecoveryCandidate(portal, context, candidatePath, managed.rootStat)) {
        validCandidates.push(candidatePath);
      }
    }
    const currentStat = await statOrNull(portal, currentPath);
    if (currentStat !== null) {
      let currentValid = false;
      try {
        assertDirectDirectory(currentPath, currentStat);
        await validateReopened(portal, context, 'current-reopen-validation', currentPath);
        currentValid = true;
      } catch {
        currentValid = false;
      }
      if (currentValid) {
        await removeRecoveryJournals(portal, context, stagingRoot, journals);
        args.barrier.repair(slug);
        entries.push(Object.freeze({
          slug,
          status: 'current-valid',
          currentPath,
          restoredPath: null,
          candidatePaths,
          reason: null,
        }));
      } else if (validCandidates.length === 1) {
        const restoredPath = validCandidates[0]!;
        const quarantinePath = portal.join(
          quarantineRoot,
          `${slug}.${args.operationToken}.invalid-current`,
        );
        let invalidCurrentMoved = false;
        let replacedFolderRestored = false;
        try {
          await assertMissing(portal, quarantinePath);
          await checkpoint(portal, context, 'before', 'current-to-quarantine', quarantinePath);
          await portal.rename(currentPath, quarantinePath);
          invalidCurrentMoved = true;
          await checkpoint(portal, context, 'after', 'current-to-quarantine', quarantinePath);
          await syncDirectory(portal, context, publishedRoot);
          await syncDirectory(portal, context, quarantineRoot);
          await assertMissing(portal, currentPath);
          await checkpoint(portal, context, 'before', 'trash-to-current', currentPath);
          await portal.rename(restoredPath, currentPath);
          replacedFolderRestored = true;
          await checkpoint(portal, context, 'after', 'trash-to-current', currentPath);
          await syncDirectory(portal, context, trashRoot);
          await syncDirectory(portal, context, publishedRoot);
          await validateReopened(portal, context, 'current-reopen-validation', currentPath);
        } catch (recoveryError) {
          const gapError = errorWithCode(
            'PUBLICATION_PATH_GAP',
            !invalidCurrentMoved
              ? `Widget '${slug}' invalid current folder could not be quarantined.`
              : replacedFolderRestored
                ? `Widget '${slug}' restored folder failed reopened validation.`
                : `Widget '${slug}' could not restore its validated replaced folder.`,
            recoveryError,
          );
          args.barrier.poison(gapError, slug);
          throw gapError;
        }
        await removeRecoveryJournals(portal, context, stagingRoot, journals);
        args.barrier.repair(slug);
        entries.push(Object.freeze({
          slug,
          status: 'restored',
          currentPath,
          restoredPath,
          candidatePaths,
          reason: `Invalid interrupted current folder moved to '${quarantinePath}'.`,
        }));
      } else {
        const ambiguous = validCandidates.length > 1;
        const reason = ambiguous
          ? 'Current folder is invalid and more than one replaced folder validates; recovery refuses to guess.'
          : 'Current folder is invalid and no replaced folder can be restored.';
        args.barrier.poison(errorWithCode(
          'PUBLICATION_PATH_GAP',
          `Widget '${slug}': ${reason}`,
        ), slug);
        entries.push(Object.freeze({
          slug,
          status: ambiguous ? 'ambiguous' : 'current-invalid',
          currentPath,
          restoredPath: null,
          candidatePaths,
          reason,
        }));
      }
      continue;
    }

    if (validCandidates.length === 1) {
      const restoredPath = validCandidates[0]!;
      try {
        await assertMissing(portal, currentPath);
        await checkpoint(portal, context, 'before', 'trash-to-current', currentPath);
        await portal.rename(restoredPath, currentPath);
        await checkpoint(portal, context, 'after', 'trash-to-current', currentPath);
        await syncDirectory(portal, context, trashRoot);
        await syncDirectory(portal, context, publishedRoot);
        await validateReopened(portal, context, 'current-reopen-validation', currentPath);
      } catch (recoveryError) {
        const gapError = errorWithCode(
          'PUBLICATION_PATH_GAP',
          `Widget '${slug}' could not restore its one validated replaced folder.`,
          recoveryError,
        );
        args.barrier.poison(gapError, slug);
        throw gapError;
      }
      await removeRecoveryJournals(portal, context, stagingRoot, journals);
      args.barrier.repair(slug);
      entries.push(Object.freeze({
        slug,
        status: 'restored',
        currentPath,
        restoredPath,
        candidatePaths,
        reason: null,
      }));
      continue;
    }

    const status = validCandidates.length > 1 ? 'ambiguous' : 'unrecoverable';
    const reason = validCandidates.length > 1
      ? 'More than one validated replaced folder exists; recovery refuses to guess.'
      : 'No validated replaced folder exists for the interrupted replacement.';
    const gapError = errorWithCode('PUBLICATION_PATH_GAP', `Widget '${slug}': ${reason}`);
    args.barrier.poison(gapError, slug);
    entries.push(Object.freeze({
      slug,
      status,
      currentPath,
      restoredPath: null,
      candidatePaths,
      reason,
    }));
  }

  if (scan.issues.length > 0) {
    args.barrier.poison(errorWithCode(
      'PUBLICATION_PATH_GAP',
      'Recovery journals contain invalid or unbounded entries; root recovery is incomplete.',
    ), PUBLICATION_RECOVERY_SCAN_SCOPE);
  } else args.barrier.repair(PUBLICATION_RECOVERY_SCAN_SCOPE);
  return Object.freeze({
    entries: Object.freeze(entries),
    issues: scan.issues,
  });
}

export async function txRecoverAtomicPublications(
  portal: TPortal,
  args: TArgsRecover,
): Promise<TPublicationRecoveryResult> {
  if (!fnIsPublicationToken(args.operationToken) || !fnIsPublicationToken(args.lockOwnerToken)) {
    throw errorWithCode('INVALID_PUBLICATION_INPUT', 'Recovery tokens are invalid.');
  }
  const rootContext: TTransitionContext = Object.freeze({
    slug: '*',
    operationToken: args.operationToken,
  });
  const rootStat = await portal.lstat(args.widgetRoot);
  assertDirectDirectory(args.widgetRoot, rootStat);
  const serializedLock = await acquireWriterLock(
    portal,
    rootContext,
    args.widgetRoot,
    args.lockOwnerToken,
    'recover',
  );
  let operationError: unknown;
  try {
    return await args.barrier.withWrite(() => recoverInsideBarrier(portal, args));
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseWriterLock(portal, rootContext, args.widgetRoot, serializedLock);
    } catch (releaseError) {
      if (operationError === undefined) throw releaseError;
      throw errorWithCode(
        'WRITER_LOCK_LOST',
        'Recovery failed and its writer lock could not be safely released.',
        { operationError, releaseError },
      );
    }
  }
}

export async function txAcquireWidgetRootWriterLease(
  portal: TPortal,
  args: TArgsAcquireLease,
): Promise<TWidgetRootWriterLease> {
  if (!fnIsPublicationToken(args.operationToken) || !fnIsPublicationToken(args.ownerToken)) {
    throw errorWithCode('INVALID_PUBLICATION_INPUT', 'Writer lease tokens are invalid.');
  }
  if (args.purpose !== 'draft' && args.purpose !== 'import' && args.purpose !== 'preview') {
    throw errorWithCode('INVALID_PUBLICATION_INPUT', 'Writer lease purpose is invalid.');
  }
  const context: TTransitionContext = Object.freeze({
    slug: '*',
    operationToken: args.operationToken,
  });
  const rootStat = await portal.lstat(args.widgetRoot);
  assertDirectDirectory(args.widgetRoot, rootStat);
  const serialized = await acquireWriterLock(
    portal,
    context,
    args.widgetRoot,
    args.ownerToken,
    args.purpose,
  );
  const path = portal.join(args.widgetRoot, PUBLICATION_LOCK_FILE);
  let released = false;
  return Object.freeze({
    path,
    serialized,
    purpose: args.purpose,
    async release() {
      if (released) throw errorWithCode('WRITER_LOCK_LOST', 'Writer lease was already released.');
      await releaseWriterLock(portal, context, args.widgetRoot, serialized);
      released = true;
    },
  });
}

export async function txClearStalePublicationWriterLock(
  portal: TPortal,
  args: TArgsClearStaleLock,
): Promise<void> {
  if (args.confirmation !== 'explicitly-confirmed-no-live-writer') {
    throw errorWithCode(
      'STALE_LOCK_CONFIRMATION_REQUIRED',
      'A writer lock can be cleared only after explicit confirmation that no writer is live.',
    );
  }
  if (!fnIsPublicationToken(args.operationToken)) {
    throw errorWithCode('INVALID_PUBLICATION_INPUT', 'Stale-lock operation token is invalid.');
  }
  const context: TTransitionContext = Object.freeze({
    slug: '*',
    operationToken: args.operationToken,
  });
  const lockPath = portal.join(args.widgetRoot, PUBLICATION_LOCK_FILE);
  const result = await mutate(
    portal,
    context,
    'lock-remove',
    lockPath,
    () => portal.removeFileIfContentsMatch(
      lockPath,
      args.expectedSerializedLock,
      context.operationToken,
    ),
  );
  if (result !== 'removed') {
    throw errorWithCode(
      'STALE_LOCK_CHANGED',
      result === 'missing'
        ? 'The observed stale writer lock is already gone.'
        : 'The writer lock changed after it was observed; it was not cleared.',
    );
  }
  await syncDirectory(portal, context, args.widgetRoot);
}

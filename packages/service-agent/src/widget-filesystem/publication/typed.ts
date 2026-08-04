/**
 * @file Self-contained contracts for crash-safe filesystem publication.
 *
 * The publication lane deliberately knows nothing about databases, tenants,
 * builders, or Capsule implementations. Upstream code supplies already-built
 * bytes; injected ports supply every filesystem read and mutation.
 */

export type TPublicationDigestFence = Readonly<{
  draftDigestSha256: string;
  catalogDigestSha256: string;
}>;

export type TPreparedPublicationFile = Readonly<{
  /** Safe path relative to the publication folder. */
  path: string;
  bytes: Uint8Array | string;
}>;

export type TPublicationValidation =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reason: string }>;

export type TPublicationWriterLockPurpose =
  | 'publish'
  | 'metadata'
  | 'draft'
  | 'recover'
  | 'import'
  | 'preview';

export type TPublicationWriterLockRecord = Readonly<{
  format: 'omnidraw.widget-writer-lock.v1';
  ownerToken: string;
  purpose: TPublicationWriterLockPurpose;
}>;

export type TPublicationWriterLockObservation = Readonly<{
  path: string;
  serialized: string;
  record: TPublicationWriterLockRecord;
}>;

export type TPublicationRecoveryJournal = Readonly<{
  format: 'omnidraw.widget-replacement.v1';
  slug: string;
  operationToken: string;
  stageName: string;
  replacedName: string;
}>;

export type TPublicationTransition =
  | 'lock-create'
  | 'lock-remove'
  | 'directory-create'
  | 'stage-file-write'
  | 'release-write'
  | 'journal-write'
  | 'journal-remove'
  | 'metadata-file-write'
  | 'metadata-to-current'
  | 'metadata-rollback-to-current'
  | 'metadata-reopen-validation'
  | 'file-sync'
  | 'directory-sync'
  | 'stage-reopen-validation'
  | 'replaced-reopen-validation'
  | 'current-to-trash'
  | 'stage-to-current'
  | 'current-to-quarantine'
  | 'trash-to-current'
  | 'current-reopen-validation';

export type TPublicationTransitionEvent = Readonly<{
  format: 'omnidraw.widget-publication-transition.v1';
  timing: 'before' | 'after';
  transition: TPublicationTransition;
  slug: string;
  operationToken: string;
  path: string | null;
}>;

export type TPublicationFileStat = Readonly<{
  dev: number | bigint;
  size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}>;

export type TPublicationDirectoryEntry = Readonly<{
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}>;

export type TPublicationCompareRemoveResult = 'removed' | 'missing' | 'mismatch';

export type TPublicationPortal = Readonly<{
  join(...parts: string[]): string;
  lstat(path: string): Promise<TPublicationFileStat>;
  readdir(
    path: string,
    options: Readonly<{ withFileTypes: true }>,
  ): Promise<readonly TPublicationDirectoryEntry[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  mkdir(
    path: string,
    options: Readonly<{ recursive: false; mode: number }>,
  ): Promise<unknown>;
  writeFile(
    path: string,
    bytes: Uint8Array | string,
    options: Readonly<{ flag: 'wx'; mode: number }>,
  ): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  /**
   * Identity-checks and removes `path` only while its complete bytes still
   * equal `expected`. Callers must either hold the represented writer lease or
   * have explicit confirmation that no live writer exists; this is not a PID-
   * or timeout-based lock-stealing primitive.
   */
  removeFileIfContentsMatch(
    path: string,
    expected: string,
    claimToken: string,
  ): Promise<TPublicationCompareRemoveResult>;
  syncFile(path: string): Promise<unknown>;
  syncDirectory(path: string): Promise<unknown>;
  observeFence(args: Readonly<{ slug: string }>): Promise<TPublicationDigestFence>;
  validateReopenedPublication(args: Readonly<{
    slug: string;
    path: string;
  }>): Promise<TPublicationValidation>;
  validateMetadataCandidate(args: Readonly<{
    slug: string;
    currentPath: string;
    manifestJson: string;
    expectedExecutableManifestDigestSha256: string;
  }>): Promise<TPublicationValidation>;
  onTransition(event: TPublicationTransitionEvent): Promise<unknown>;
}>;

/** App-owned checks composed with the production Node filesystem primitives. */
export type TNodeWidgetPublicationFilesystemHooks = Readonly<{
  observeFence: TPublicationPortal['observeFence'];
  validateReopenedPublication: TPublicationPortal['validateReopenedPublication'];
  /** Must strictly parse the manifest and recompute its executable digest. */
  validateMetadataCandidate: TPublicationPortal['validateMetadataCandidate'];
  onTransition?: TPublicationPortal['onTransition'];
  /** Optional diagnostic/fault hook after an exact-removal path is claimed. */
  onCompareRemoveClaimed?: (args: Readonly<{
    path: string;
    claimPath: string;
  }>) => Promise<unknown>;
}>;

export type TNodeWidgetPublicationFilesystemInput = Readonly<{
  widgetRoot: string;
  hooks: TNodeWidgetPublicationFilesystemHooks;
}>;

export type TPublicationReadWriteBarrier = Readonly<{
  withRead<T>(operation: () => T | Promise<T>): Promise<T>;
  withWrite<T>(operation: () => T | Promise<T>): Promise<T>;
  poison(reason: Error, scope?: string): void;
  repair(scope: string): void;
  isPoisoned(scope?: string): boolean;
}>;

export type TAtomicPublicationInput = Readonly<{
  widgetRoot: string;
  slug: string;
  operationToken: string;
  lockOwnerToken: string;
  expectedFence: TPublicationDigestFence;
  /** Canonical authored manifest bytes written as `omnidraw.json`. */
  manifestJson: string;
  /** Runtime files only; excludes `omnidraw.json` and `release.json`. */
  files: readonly TPreparedPublicationFile[];
  /** Canonical complete release descriptor bytes, written last. */
  releaseJson: string;
  barrier: TPublicationReadWriteBarrier;
}>;

export type TAtomicPublicationResult = Readonly<{
  status: 'committed';
  slug: string;
  operationToken: string;
  currentPath: string;
  replacedPath: string | null;
}>;

export type TMetadataPublicationInput = Readonly<{
  widgetRoot: string;
  slug: string;
  operationToken: string;
  lockOwnerToken: string;
  expectedFence: TPublicationDigestFence;
  expectedExecutableManifestDigestSha256: string;
  newExecutableManifestDigestSha256: string;
  manifestJson: string;
  barrier: TPublicationReadWriteBarrier;
}>;

export type TMetadataPublicationResult = Readonly<{
  status: 'metadata-committed';
  slug: string;
  operationToken: string;
  currentPath: string;
  manifestPath: string;
}>;

export type TPublicationInputValidation =
  | Readonly<{
      valid: true;
      files: readonly TPreparedPublicationFile[];
      directories: readonly string[];
    }>
  | Readonly<{
      valid: false;
      reason: string;
    }>;

export type TPublicationRecoveryIssue = Readonly<{
  path: string;
  reason: string;
}>;

export type TPublicationRecoveryJournalObservation = Readonly<{
  path: string;
  serialized: string;
  journal: TPublicationRecoveryJournal;
}>;

export type TPublicationRecoveryScan = Readonly<{
  journals: readonly TPublicationRecoveryJournalObservation[];
  issues: readonly TPublicationRecoveryIssue[];
}>;

export type TPublicationRecoveryEntry = Readonly<{
  slug: string;
  status:
    | 'current-valid'
    | 'current-invalid'
    | 'restored'
    | 'ambiguous'
    | 'unrecoverable';
  currentPath: string;
  restoredPath: string | null;
  candidatePaths: readonly string[];
  reason: string | null;
}>;

export type TPublicationRecoveryResult = Readonly<{
  entries: readonly TPublicationRecoveryEntry[];
  issues: readonly TPublicationRecoveryIssue[];
}>;

export type TRecoverPublicationsInput = Readonly<{
  widgetRoot: string;
  operationToken: string;
  lockOwnerToken: string;
  barrier: TPublicationReadWriteBarrier;
}>;

export type TClearStaleWriterLockInput = Readonly<{
  widgetRoot: string;
  operationToken: string;
  /** Exact bytes returned by `fxReadPublicationWriterLock`. */
  expectedSerializedLock: string;
  /** Deliberately cannot be inferred from a PID or elapsed time. */
  confirmation: 'explicitly-confirmed-no-live-writer';
}>;

export type TAcquireWidgetRootWriterLeaseInput = Readonly<{
  widgetRoot: string;
  operationToken: string;
  ownerToken: string;
  purpose: 'draft' | 'import' | 'preview';
}>;

export type TWidgetRootWriterLease = Readonly<{
  path: string;
  serialized: string;
  purpose: 'draft' | 'import' | 'preview';
  release(): Promise<void>;
}>;

export type TPublicationErrorCode =
  | 'INVALID_PUBLICATION_INPUT'
  | 'WRITER_LOCK_HELD'
  | 'WRITER_LOCK_LOST'
  | 'PUBLICATION_FENCE_CONFLICT'
  | 'UNSAFE_PUBLICATION_PATH'
  | 'CROSS_DEVICE_STAGE'
  | 'PUBLICATION_VALIDATION_FAILED'
  | 'PUBLICATION_PATH_GAP'
  | 'STALE_LOCK_CONFIRMATION_REQUIRED'
  | 'STALE_LOCK_CHANGED';

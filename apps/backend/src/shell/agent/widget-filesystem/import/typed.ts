/** @file Types for copy-only, trust-explicit filesystem widget imports. */

export type TWidgetImportSource =
  | Readonly<{ kind: 'remote'; locator: string }>
  | Readonly<{ kind: 'external-checkout'; locator: string }>;

/** Local application policy. This value is never read from `omnidraw.json`. */
export type TWidgetImportLocalTrustPolicy =
  | Readonly<{ kind: 'isolated' }>
  | Readonly<{ kind: 'trusted-local' }>;

export type TWidgetImportRunner =
  | Readonly<{
      kind: 'isolated';
      reason: 'default-untrusted-source' | 'explicit-isolation';
    }>
  | Readonly<{
      kind: 'host';
      trust: 'trusted-local';
    }>;

export type TWidgetImportTreeEntry = Readonly<{
  path: string;
  kind: 'file' | 'directory' | 'symbolic-link' | 'junction' | 'special';
}>;

export type TWidgetImportManagedTreeObservation = Readonly<{
  entries: readonly TWidgetImportTreeEntry[];
  /** Digest over exact relative paths, entry kinds, lengths, and file bytes. */
  digestSha256: string;
}>;

export type TWidgetImportPlan = Readonly<{
  slug: string;
  stagingRelativePath: string;
  draftRelativePath: string;
  copyMode: 'copy-files-no-follow';
}>;

export type TWidgetImportPlanResult =
  | Readonly<{ ok: true; plan: TWidgetImportPlan }>
  | Readonly<{
      ok: false;
      reason:
        | 'invalid_slug'
        | 'invalid_operation_id'
        | 'draft_exists'
        | 'draft_case_collision';
      collision?: string;
    }>;

export type TWidgetImportTreeValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason:
        | 'too_many_entries'
        | 'unsafe_path'
        | 'duplicate_path'
        | 'case_collision'
        | 'link_not_allowed'
        | 'special_file_not_allowed';
      path?: string;
      collision?: string;
    }>;

export type TWidgetImportWriterLease = Readonly<{
  release(): Promise<void>;
}>;

export type TWidgetImportPorts<TCheckout, TBuildResult> = Readonly<{
  createOperationId(): string;
  acquireSource(args: Readonly<{
    source: TWidgetImportSource;
    signal: AbortSignal;
  }>): Promise<TCheckout>;
  releaseSource(args: Readonly<{ checkout: TCheckout }>): Promise<void>;
  inspectManifest(args: Readonly<{
    checkout: TCheckout;
    signal: AbortSignal;
  }>): Promise<Readonly<{ slug: string }>>;
  listDraftDirectoryNames(args: Readonly<{ signal: AbortSignal }>): Promise<readonly string[]>;
  prepareStaging(args: Readonly<{
    relativePath: string;
    expectedAbsent: true;
    signal: AbortSignal;
  }>): Promise<void>;
  copyCheckout(args: Readonly<{
    checkout: TCheckout;
    destinationRelativePath: string;
    mode: 'copy-files-no-follow';
    signal: AbortSignal;
  }>): Promise<void>;
  captureManagedTree(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<TWidgetImportManagedTreeObservation>;
  inspectManagedManifest(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<Readonly<{ slug: string }>>;
  build(args: Readonly<{
    sourceRelativePath: string;
    runner: TWidgetImportRunner;
    expectedTreeDigestSha256: string;
    signal: AbortSignal;
  }>): Promise<TBuildResult>;
  acquireWriterLease(args: Readonly<{ signal: AbortSignal }>): Promise<TWidgetImportWriterLease>;
  promoteStaging(args: Readonly<{
    stagingRelativePath: string;
    draftRelativePath: string;
    expectedDraftAbsent: true;
    expectedTreeDigestSha256: string;
    signal: AbortSignal;
  }>): Promise<void>;
  removeManagedPath(args: Readonly<{ relativePath: string }>): Promise<void>;
}>;

export type TWidgetImportRequest = Readonly<{
  source: TWidgetImportSource;
  /** Explicit local choice. Omission always means isolated execution. */
  localTrustPolicy?: TWidgetImportLocalTrustPolicy;
  signal?: AbortSignal;
}>;

export type TWidgetImportResult<TBuildResult> = Readonly<{
  slug: string;
  draftRelativePath: string;
  sourceTreeDigestSha256: string;
  runner: TWidgetImportRunner;
  build: TBuildResult;
}>;

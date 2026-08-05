/**
 * @file Filesystem-first widget catalog observations and injected edge ports.
 */

import type {
  TWidgetManifestV1,
  TWidgetPresentationProjection,
  TWidgetExecutableManifestProjection,
  TWidgetReleaseDescriptor,
  TWidgetReleaseAttestation,
  TWidgetReleaseFile,
  TWidgetReleaseObservation,
  TWidgetReleaseValidation,
} from '@omnidraw/widget-contract/filesystem';
import type {
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';

export type TWidgetCatalogForm = 'draft' | 'published';

export type TWidgetCatalogIssueCode =
  | 'layout_missing'
  | 'layout_entry_invalid'
  | 'layout_case_collision'
  | 'unexpected_layout_entry'
  | 'unsafe_slug'
  | 'slug_case_collision'
  | 'widget_entry_not_directory'
  | 'unsafe_path'
  | 'path_case_collision'
  | 'symlink_not_allowed'
  | 'special_file_not_allowed'
  | 'scan_depth_exceeded'
  | 'scan_entry_count_exceeded'
  | 'scan_file_count_exceeded'
  | 'scan_directory_count_exceeded'
  | 'scan_file_size_exceeded'
  | 'scan_total_size_exceeded'
  | 'scan_widget_count_exceeded'
  | 'scan_global_entry_count_exceeded'
  | 'scan_global_directory_count_exceeded'
  | 'scan_global_file_count_exceeded'
  | 'scan_global_total_size_exceeded'
  | 'filesystem_changed'
  | 'filesystem_read_failed'
  | 'manifest_missing'
  | 'manifest_invalid'
  | 'manifest_slug_mismatch'
  | 'release_missing'
  | 'release_invalid'
  | 'functions_invalid'
  | 'capsule_inspection_failed'
  | 'release_validation_failed';

export type TWidgetCatalogIssue = Readonly<{
  scope: 'root' | TWidgetCatalogForm;
  code: TWidgetCatalogIssueCode;
  message: string;
  path: string | null;
}>;

export type TWidgetCatalogFileObservation = TWidgetReleaseFile;

export type TWidgetCatalogDraft = Readonly<{
  kind: 'draft';
  slug: string;
  relativePath: string;
  health: 'healthy' | 'unhealthy';
  manifest: TWidgetManifestV1 | null;
  manifestDigestSha256: string | null;
  presentation: TWidgetPresentationProjection | null;
  presentationDigestSha256: string | null;
  executable: TWidgetExecutableManifestProjection | null;
  executableManifestDigestSha256: string | null;
  treeDigestSha256: string;
  files: readonly TWidgetCatalogFileObservation[];
  issues: readonly TWidgetCatalogIssue[];
}>;

export type TWidgetCatalogPublished = Readonly<{
  kind: 'published';
  slug: string;
  relativePath: string;
  health: 'healthy' | 'unhealthy';
  manifest: TWidgetManifestV1 | null;
  manifestDigestSha256: string | null;
  presentation: TWidgetPresentationProjection | null;
  presentationDigestSha256: string | null;
  executable: TWidgetExecutableManifestProjection | null;
  executableManifestDigestSha256: string | null;
  treeDigestSha256: string;
  files: readonly TWidgetCatalogFileObservation[];
  release: TWidgetReleaseDescriptor | null;
  releaseDescriptorDigestSha256: string | null;
  releaseValidation: TWidgetReleaseValidation | null;
  capsuleRuntime: TWidgetCapsuleRuntimeDescriptor | null;
  functions: readonly TWidgetServerFunctionDescriptor[] | null;
  issues: readonly TWidgetCatalogIssue[];
}>;

export type TWidgetCatalogDifferenceState = 'same' | 'different' | 'unavailable';

export type TWidgetCatalogDifferences = Readonly<{
  availability: 'draft-only' | 'published-only' | 'draft-and-published';
  manifest: TWidgetCatalogDifferenceState;
  presentation: TWidgetCatalogDifferenceState;
  executableManifest: TWidgetCatalogDifferenceState;
  status:
    | 'draft-only'
    | 'published-only'
    | 'matched'
    | 'presentation-changed'
    | 'executable-changed'
    | 'unavailable';
}>;

export type TWidgetCatalogEntry = Readonly<{
  slug: string;
  health: 'healthy' | 'degraded' | 'unhealthy';
  placeable: boolean;
  draft: TWidgetCatalogDraft | null;
  published: TWidgetCatalogPublished | null;
  differences: TWidgetCatalogDifferences;
}>;

export type TWidgetCatalogSnapshot = Readonly<{
  format: 'omnidraw.widget-catalog.v1';
  generation: number;
  digestSha256: string;
  rootIdentity: string;
  healthy: boolean;
  entries: Readonly<Record<string, TWidgetCatalogEntry>>;
  issues: readonly TWidgetCatalogIssue[];
}>;

export type TPinnedWidgetCatalogRoot = Readonly<{
  canonicalPath: string;
  identity: string;
}>;

export type TWidgetCatalogFilesystemEntry = Readonly<{
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'special';
  byteSize: number | null;
}>;

export type TWidgetCatalogDirectoryObservation = Readonly<{
  relativePath: string;
  token: string;
  entries: readonly TWidgetCatalogFilesystemEntry[];
}>;

export type TWidgetCatalogFilesystemPortal = Readonly<{
  pinRoot(args: Readonly<{ requestedPath: string }>): Promise<TPinnedWidgetCatalogRoot>;
  assertRoot(root: TPinnedWidgetCatalogRoot, args: Readonly<Record<string, never>>): Promise<void>;
  readDirectory(
    root: TPinnedWidgetCatalogRoot,
    args: Readonly<{ relativePath: string; maxEntries: number }>,
  ): Promise<TWidgetCatalogDirectoryObservation>;
  assertDirectoryUnchanged(
    root: TPinnedWidgetCatalogRoot,
    args: Readonly<{
      observation: TWidgetCatalogDirectoryObservation;
      maxEntries: number;
    }>,
  ): Promise<void>;
  readFile(
    root: TPinnedWidgetCatalogRoot,
    args: Readonly<{ relativePath: string; maxBytes: number }>,
  ): Promise<Uint8Array>;
  decodeUtf8(args: Readonly<{ bytes: Uint8Array }>): string;
}>;

export type TWidgetCatalogHashPortal = Readonly<{
  digestSha256(args: Readonly<{ value: string | Uint8Array }>): string;
}>;

/** The implementation must verify the signature and current host policy. */
export type TWidgetCatalogCapsuleInspectionPortal = Readonly<{
  inspectCapsuleArtifact(args: Readonly<{
    bytes: Uint8Array;
    expectedApis: TWidgetManifestV1['ui']['apis'];
    expectedRuntime: TWidgetCapsuleRuntimeDescriptor;
    expectedCapsuleFile: TWidgetReleaseFile;
    canonicalUnsignedReleaseJson: string;
    releaseAttestation: TWidgetReleaseAttestation;
  }>): Promise<Readonly<{
    artifactHash: `sha256:${string}`;
    runtime: TWidgetCapsuleRuntimeDescriptor;
  }>>;
}>;

export type TWidgetCatalogContractPortal = Readonly<{
  normalizeRelativePath(value: string): string | null;
  parseManifestJson(value: string): TWidgetManifestV1;
  parseReleaseJson(value: string): TWidgetReleaseDescriptor;
  parseFunctionsJson(value: string): readonly TWidgetServerFunctionDescriptor[];
  projectPresentation(manifest: TWidgetManifestV1): TWidgetPresentationProjection;
  projectExecutable(manifest: TWidgetManifestV1): TWidgetExecutableManifestProjection;
  canonicalizePresentation(manifest: TWidgetManifestV1): string;
  manifestDigest(args: Readonly<{
    manifest: TWidgetManifestV1;
    digestSha256(value: string): string;
  }>): string;
  executableManifestDigest(args: Readonly<{
    manifest: TWidgetManifestV1;
    digestSha256(value: string): string;
  }>): string;
  releaseDirectoryDigest(args: Readonly<{
    files: readonly TWidgetReleaseFile[];
    digestSha256(value: string): string;
  }>): string;
  canonicalizeUnsignedRelease(release: TWidgetReleaseDescriptor): string;
  validateRelease(args: Readonly<{
    manifest: TWidgetManifestV1;
    expectedExecutableManifestDigestSha256: string;
    release: TWidgetReleaseDescriptor;
    observation: TWidgetReleaseObservation;
  }>): TWidgetReleaseValidation;
}>;

export type TWidgetCatalogScanPortal = Readonly<{
  filesystem: TWidgetCatalogFilesystemPortal;
  hash: TWidgetCatalogHashPortal;
  capsule: TWidgetCatalogCapsuleInspectionPortal;
  contracts: TWidgetCatalogContractPortal;
}>;

export type TWidgetCatalogScanLimits = Readonly<{
  maxWidgetForms: number;
  maxGlobalEntries: number;
  maxGlobalDirectories: number;
  maxGlobalFiles: number;
  maxGlobalTotalBytes: number;
  maxEntriesPerWidget: number;
  maxDepth: number;
  maxDirectoriesPerWidget: number;
  maxEntriesPerDirectory: number;
  draftMaxFiles: number;
  draftMaxFileBytes: number;
  draftMaxTotalBytes: number;
  publishedMaxFiles: number;
  publishedMaxFileBytes: number;
  publishedMaxTotalBytes: number;
}>;

export type TWidgetCatalogReadBarrier = Readonly<{
  withRead<T>(operation: () => T | Promise<T>): Promise<T>;
}>;

export type TWidgetFilesystemCatalogConfig = Readonly<{
  rootPath: string;
  filesystem: TWidgetCatalogFilesystemPortal;
  hash: TWidgetCatalogHashPortal;
  capsule: TWidgetCatalogCapsuleInspectionPortal;
  contracts?: TWidgetCatalogContractPortal;
  limits?: Partial<TWidgetCatalogScanLimits>;
  /** Share the publication barrier so a two-rename replacement gap is never observed. */
  barrier?: TWidgetCatalogReadBarrier;
}>;

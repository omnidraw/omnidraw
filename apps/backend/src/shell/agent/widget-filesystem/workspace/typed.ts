/** @file Concrete filesystem workspace contracts shared by import and Preview. */

import type {
  TWidgetExecutableInputFile,
  TWidgetManifestV1,
  TWidgetReleaseFile,
} from '@omnidraw/sdk/contract';
import type {
  TWidgetImportTreeEntry,
} from '../import/typed';

export type TWidgetWorkspaceManagedNamespace = 'staging' | 'preview' | 'draft';

export type TWidgetWorkspaceManagedPath = Readonly<{
  namespace: TWidgetWorkspaceManagedNamespace;
  relativePath: string;
  rootRelativePath: string;
  segments: readonly string[];
}>;

export type TWidgetWorkspaceTreeCapture = Readonly<{
  format: 'omnidraw.widget-managed-tree.v1';
  rootRelativePath: string;
  entries: readonly TWidgetImportTreeEntry[];
  files: readonly TWidgetReleaseFile[];
  fileCount: number;
  directoryCount: number;
  byteSize: number;
  digestSha256: string;
}>;

export type TWidgetWorkspaceManifestObservation = Readonly<{
  slug: string;
  manifest: TWidgetManifestV1;
  canonicalJson: string;
  manifestDigestSha256: string;
  treeDigestSha256: string;
}>;

export type TWidgetWorkspaceDraftBuildCapture = Readonly<{
  slug: string;
  manifest: TWidgetManifestV1;
  canonicalManifestJson: string;
  manifestDigestSha256: string;
  treeDigestSha256: string;
  fileSetDigestSha256: string;
  files: readonly TWidgetExecutableInputFile[];
}>;

export type TWidgetWorkspaceDraftManifestSaveResult = Readonly<{
  slug: string;
  manifest: TWidgetManifestV1;
  canonicalJson: string;
  previousManifestDigestSha256: string;
  manifestDigestSha256: string;
}>;

export type TWidgetWorkspaceLimits = Readonly<{
  maxDepth: number;
  maxEntries: number;
  maxEntriesPerDirectory: number;
  maxDirectories: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxPathBytes: number;
}>;

export type TNodeWidgetFilesystemWorkspaceConfig = Readonly<{
  rootPath: string;
  limits?: Partial<TWidgetWorkspaceLimits>;
}>;

export type TWidgetImportWorkspacePortConfig<TCheckout> = Readonly<{
  checkoutRootPath(checkout: TCheckout): string;
}>;

export type TWidgetImportWorkspacePorts<TCheckout> = Readonly<{
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
  observeManagedTree(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<readonly TWidgetImportTreeEntry[]>;
  captureManagedTree(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<TWidgetWorkspaceTreeCapture>;
  inspectManagedManifest(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<TWidgetWorkspaceManifestObservation>;
  promoteStaging(args: Readonly<{
    stagingRelativePath: string;
    draftRelativePath: string;
    expectedDraftAbsent: true;
    expectedTreeDigestSha256: string;
    signal: AbortSignal;
  }>): Promise<void>;
  removeManagedPath(args: Readonly<{ relativePath: string }>): Promise<void>;
}>;

export type TWidgetPreviewWorkspacePorts = Readonly<{
  prepareTempPath(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<void>;
  removeTempPath(args: Readonly<{ relativePath: string }>): Promise<void>;
}>;

export type TWidgetWorkspaceWriterLease = Readonly<{
  release(): Promise<void>;
}>;

export type TWidgetWorkspaceWriterLeasePort = Readonly<{
  acquireWriterLease(args: Readonly<{
    signal?: AbortSignal;
  }>): Promise<TWidgetWorkspaceWriterLease>;
}>;

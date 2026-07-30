import type {
  CapsuleBuildOutput,
  CapsuleApiGroupBuildRequest,
  CapsuleSnapshotFile,
} from '@omnidraw/capsule/build';
import type { CapsuleBuildInput } from '@omnidraw/capsule/protocol';

export type TVibecanvasCapsuleBuild = (
  request: CapsuleApiGroupBuildRequest,
) => Promise<Pick<
  CapsuleBuildOutput,
  'artifactBytes' | 'artifactHash' | 'diagnostics'
>>;

export type TVibecanvasDistributionBuildRequest = Readonly<{
  sourceRevision: string;
  entry: string;
  files: readonly CapsuleSnapshotFile[];
  workspaceKey?: string;
  signal?: AbortSignal;
  reportProgress?: (phase: 'installing' | 'building') => void;
}>;

/** Trusted generated maps retained outside the Capsule guest distribution. */
export type TVibecanvasDistributionSourceMap = Readonly<{
  module: string;
  bytes: Uint8Array;
}>;

export type TVibecanvasDistributionBuildOutput =
  CapsuleBuildInput & Readonly<{
    sourceMaps?: readonly TVibecanvasDistributionSourceMap[];
  }>;

export type TVibecanvasDistributionBuild = ((
  request: TVibecanvasDistributionBuildRequest,
) => Promise<TVibecanvasDistributionBuildOutput>) & Readonly<{
  closeWorkspace?(workspaceKey: string): Promise<void>;
  close?(): Promise<void>;
}>;

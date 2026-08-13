import type {
  CapsuleBuildOutput,
  CapsuleApiGroupBuildRequest,
  CapsuleSnapshotFile,
} from '@omnidraw/capsule/build';
import type { CapsuleBuildInput } from '@omnidraw/capsule/protocol';
import type { TWidgetExecutableManifestProjection } from '@omnidraw/sdk/contract';

export type TOmnidrawCapsuleBuild = (
  request: CapsuleApiGroupBuildRequest,
) => Promise<Pick<
  CapsuleBuildOutput,
  'artifactBytes' | 'artifactHash' | 'diagnostics'
>>;

export type TOmnidrawDistributionBuildRequest = Readonly<{
  sourceRevision: string;
  entry: string;
  files: readonly CapsuleSnapshotFile[];
  executableManifest?: TWidgetExecutableManifestProjection;
  workspaceKey?: string;
  signal?: AbortSignal;
  reportProgress?: (phase: 'installing' | 'building') => void;
}>;

/** Trusted generated maps retained outside the Capsule guest distribution. */
export type TOmnidrawDistributionSourceMap = Readonly<{
  module: string;
  bytes: Uint8Array;
}>;

export type TOmnidrawDistributionBuildOutput =
  CapsuleBuildInput & Readonly<{
    sourceMaps?: readonly TOmnidrawDistributionSourceMap[];
  }>;

export type TOmnidrawDistributionBuild = ((
  request: TOmnidrawDistributionBuildRequest,
) => Promise<TOmnidrawDistributionBuildOutput>) & Readonly<{
  closeWorkspace?(workspaceKey: string): Promise<void>;
  close?(): Promise<void>;
}>;

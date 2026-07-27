import type {
  CapsuleBuildOutput,
  CapsuleBuildRequest,
  CapsuleSnapshotFile,
} from '@omnidraw/capsule/build';
import type { CapsuleBuildInput } from '@omnidraw/capsule/protocol';

export type TVibecanvasCapsuleBuild = (
  request: CapsuleBuildRequest,
) => Promise<Pick<
  CapsuleBuildOutput,
  'artifactBytes' | 'artifactHash' | 'diagnostics'
>>;

export type TVibecanvasDistributionBuildRequest = Readonly<{
  sourceRevision: string;
  entry: string;
  files: readonly CapsuleSnapshotFile[];
}>;

export type TVibecanvasDistributionBuild = (
  request: TVibecanvasDistributionBuildRequest,
) => Promise<CapsuleBuildInput>;

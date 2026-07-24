import type {
  CapsuleBuildOutput,
  CapsuleBuildRequest,
} from '@omnidraw/capsule/build';

export type TVibecanvasCapsuleBuild = (
  request: CapsuleBuildRequest,
) => Promise<Pick<
  CapsuleBuildOutput,
  'artifactBytes' | 'artifactHash' | 'diagnostics'
>>;

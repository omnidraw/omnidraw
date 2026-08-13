import { resolve } from 'node:path';

type TPreviewInspectionReleaseRuntimeArgs = Readonly<{
  sourceCliDir: string;
}>;

export type TPreviewInspectionReleaseRuntime = Readonly<{
  shellPath: string;
}>;

/**
 * Resolves the source/deployed frontend-owned Preview inspection entry.
 */
export function resolvePreviewInspectionReleaseRuntime(
  args: TPreviewInspectionReleaseRuntimeArgs,
): TPreviewInspectionReleaseRuntime {
  return Object.freeze({
    shellPath: resolve(args.sourceCliDir, '..', '..', '..', 'frontend', 'dist', 'inspection'),
  });
}

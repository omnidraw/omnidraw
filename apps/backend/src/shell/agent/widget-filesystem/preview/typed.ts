/** @file Types for ephemeral, process-owned filesystem widget Preview. */

import type { TWidgetCapsuleBuildIdentity } from '#backend/core/widget-domain';

export type TPreviewConstructionCompatibility = Readonly<{
  builderIdentity: string;
  buildPolicyId: string;
  environmentIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  serverRuntimeAbi: string | null;
}>;

export type TPreviewDiagnosticInput = Readonly<{
  severity: 'info' | 'warning' | 'error';
  message: string;
  code?: string | null;
  path?: string | null;
}>;

export type TPreviewDiagnostic = Readonly<{
  severity: 'info' | 'warning' | 'error';
  message: string;
  code: string | null;
  path: string | null;
}>;

export type TPreviewSessionPhase =
  | 'building'
  | 'validating'
  | 'signing'
  | 'mounting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export type TPreviewSessionView = Readonly<{
  sessionId: string;
  widgetKey: string;
  executableInputDigestSha256: string;
  compatibility: TPreviewConstructionCompatibility;
  tempRelativePath: string;
  phase: TPreviewSessionPhase;
  constructionReused: boolean;
  diagnostics: readonly TPreviewDiagnostic[];
  droppedDiagnosticCount: number;
  mountedHandleCount: number;
  failureMessage: string | null;
}>;

export type TPreviewOpenArgs = Readonly<{
  sessionId: string;
  widgetKey: string;
  executableInputDigestSha256: string;
  compatibility: TPreviewConstructionCompatibility;
  signal?: AbortSignal;
}>;

export type TPreviewConstructionBuildArgs = Readonly<{
  sessionId: string;
  widgetKey: string;
  executableInputDigestSha256: string;
  compatibility: TPreviewConstructionCompatibility;
  tempRelativePath: string;
  signal: AbortSignal;
  reportDiagnostic(diagnostic: TPreviewDiagnosticInput): void;
}>;

export type TPreviewPorts<TConstruction, TSignedArtifact, TMountHandle> = Readonly<{
  prepareTempPath(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<void>;
  removeTempPath(args: Readonly<{ relativePath: string }>): Promise<void>;
  buildConstruction(
    args: TPreviewConstructionBuildArgs,
  ): Promise<TConstruction>;
  validateConstruction(args: Readonly<{
    construction: TConstruction;
    executableInputDigestSha256: string;
    compatibility: TPreviewConstructionCompatibility;
    signal: AbortSignal;
  }>): Promise<void>;
  signConstruction(args: Readonly<{
    construction: TConstruction;
    executableInputDigestSha256: string;
    compatibility: TPreviewConstructionCompatibility;
    signal: AbortSignal;
  }>): Promise<TSignedArtifact>;
  mount(args: Readonly<{
    sessionId: string;
    widgetKey: string;
    signedArtifact: TSignedArtifact;
    tempRelativePath: string;
    signal: AbortSignal;
  }>): Promise<TMountHandle>;
  unmount(args: Readonly<{
    sessionId: string;
    handle: TMountHandle;
  }>): Promise<void>;
}>;

export type TPreviewServiceConfig = Readonly<{
  maxSessions?: number;
  maxCachedConstructions?: number;
  maxMountedHandles?: number;
  maxDiagnosticsPerSession?: number;
  maxDiagnosticCharacters?: number;
}>;

export type TPreviewOpenResult<TSignedArtifact, TMountHandle> = Readonly<{
  session: TPreviewSessionView;
  signedArtifact: TSignedArtifact;
  mountHandle: TMountHandle;
}>;

export type TReusablePreviewConstruction<TConstruction> = Readonly<{
  ownerSessionId: string;
  executableInputDigestSha256: string;
  compatibility: TPreviewConstructionCompatibility;
  validated: true;
  construction: TConstruction;
}>;

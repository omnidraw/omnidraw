import type {
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactConstructionSignRequest,
  TWidgetBuildEnvironment,
  TWidgetBuildResult,
  TWidgetExecutableInputFile,
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetReleaseAttestation,
  TWidgetReleaseServer,
  TWidgetSourceFile,
} from '@omnidraw/sdk/contract';

export type TWidgetFilesystemConstructionPort = Readonly<{
  construct(
    request: TWidgetArtifactConstructionRequest,
  ): Promise<TWidgetArtifactConstructionResult>;
  signConstruction(
    request: TWidgetArtifactConstructionSignRequest,
  ): Promise<TWidgetBuildResult>;
  closeWorkspace?(request: Readonly<{ workspaceKey: string }>): Promise<void>;
  close?(): Promise<void>;
}>;

export type TWidgetFilesystemCapsuleInspection = Readonly<{
  artifactHash: `sha256:${string}`;
  runtime: TWidgetBuildResult['uiArtifact']['runtimeDescriptor'];
}>;

export type TWidgetFilesystemCapsuleInspector = Readonly<{
  inspect(bytes: Uint8Array): Promise<TWidgetFilesystemCapsuleInspection>;
}>;

export type TWidgetFilesystemConstructionCache = Readonly<{
  read(key: string): Promise<TWidgetFilesystemConstruction | null>;
  delete?(key: string): Promise<void>;
  write(
    key: string,
    construction: TWidgetFilesystemConstruction,
  ): Promise<void>;
}>;

export type TWidgetFilesystemBuildServiceConfig = Readonly<{
  builderIdentity: string;
  /** Trusted identity of the concrete runner/toolchain wired to this service. */
  environment: Omit<TWidgetBuildEnvironment, 'serverRuntimeAbi'>;
  construction: TWidgetFilesystemConstructionPort;
  capsuleInspector: TWidgetFilesystemCapsuleInspector;
  /** Host release authority; signs the canonical complete unsigned release. */
  releaseAttestor: Readonly<{
    attest(canonicalUnsignedReleaseJson: string): Promise<TWidgetReleaseAttestation>;
  }>;
  /**
   * Optional durable construction cache keyed by the exact executable-input
   * digest plus builder/environment identity, so a process restart can reuse
   * the validated build instead of re-running npm/vite/Capsule. A hit is only
   * honored when every digest still matches the current request.
   */
  constructionCache?: TWidgetFilesystemConstructionCache;
}>;

export type TWidgetFilesystemConstructionRequest = Readonly<{
  manifest: TWidgetManifestV1;
  files: readonly TWidgetExecutableInputFile[];
  expectedExecutableInputDigestSha256?: string;
  workspaceKey?: string;
  signal?: AbortSignal;
  reportProgress?: (phase: 'installing' | 'building' | 'validating') => void;
}>;

export type TWidgetFilesystemConstruction = Readonly<{
  executableInputDigestSha256: string;
  executableManifestDigestSha256: string;
  canonicalExecutableManifestJson: string;
  distributionDigestSha256: string;
  construction: TWidgetArtifactConstructionResult;
  distFiles: readonly TWidgetSourceFile[];
}>;

export type TWidgetFilesystemSignedConstruction = Readonly<{
  executableInputDigestSha256: string;
  executableManifestDigestSha256: string;
  build: TWidgetBuildResult;
  capsule: TWidgetFilesystemCapsuleInspection & Readonly<{
    artifactBytes: Uint8Array;
  }>;
}>;

export type TWidgetFilesystemPreparedPublication = Readonly<{
  executableInputDigestSha256: string;
  manifestJson: string;
  browser: Readonly<{ files: readonly TWidgetSourceFile[] }>;
  capsule: Readonly<{
    artifactBytes: Uint8Array;
    artifactHash: `sha256:${string}`;
    runtime: TWidgetBuildResult['uiArtifact']['runtimeDescriptor'];
  }>;
  server: null | Readonly<{
    files: readonly TWidgetSourceFile[];
    functionsJson: string;
    serverDistDigestSha256: string;
  }>;
  files: readonly TWidgetSourceFile[];
  release: Readonly<{
    descriptor: TWidgetReleaseDescriptor;
    canonicalJson: string;
  }>;
}>;

export type TWidgetFilesystemReleaseServerInput = Omit<
  TWidgetReleaseServer,
  'functionsPath'
>;

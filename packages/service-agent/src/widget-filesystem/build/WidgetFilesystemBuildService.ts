import { createHash } from 'node:crypto';
import {
  ZWidgetManifestV4,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV4,
  fnCanonicalizeWidgetReleaseDescriptor,
  fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnCreateWidgetReleaseDescriptor,
  fnCreateWidgetUnsignedReleaseDescriptor,
  fnNormalizeWidgetFilesystemRelativePath,
  fnValidateWidgetRelease,
  fnWidgetExecutableInputDigest,
  fnWidgetExecutableManifestDigest,
  fnWidgetReleaseDirectoryDigest,
  fnProjectWidgetExecutableManifest,
  type TWidgetReleaseFile,
  type TWidgetSourceFile,
  type TWidgetSourceSnapshot,
} from '@omnidraw/widget-contract';
import type {
  TWidgetFilesystemBuildServiceConfig,
  TWidgetFilesystemConstruction,
  TWidgetFilesystemConstructionRequest,
  TWidgetFilesystemPreparedPublication,
  TWidgetFilesystemSignedConstruction,
} from './typed';

const GENERATED_BUILD_MANIFEST_PATH = '.omnidraw/build-manifest.json';
const SERVER_ARTIFACT_PATH = 'server-dist/main.artifact';

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapshotDigest(files: readonly TWidgetSourceFile[]): string {
  const digest = createHash('sha256');
  for (const file of files) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    digest.update(`${pathBytes.byteLength}:`);
    digest.update(pathBytes);
    digest.update(`:${file.bytes.byteLength}:`);
    digest.update(file.bytes);
    digest.update(';');
  }
  return digest.digest('hex');
}

function immutableFiles(files: readonly TWidgetSourceFile[]): readonly TWidgetSourceFile[] {
  const result = files.map((file) => Object.freeze({
    path: file.path,
    bytes: new Uint8Array(file.bytes),
  })).sort((left, right) => compareText(left.path, right.path));
  const folded = new Set<string>();
  for (const file of result) {
    const path = fnNormalizeWidgetFilesystemRelativePath(file.path);
    if (path === null || path !== file.path) {
      throw new TypeError(`Unsafe generated widget file path: ${file.path}`);
    }
    const key = path.toLowerCase();
    if (folded.has(key)) throw new TypeError(`Duplicate generated widget file path: ${path}`);
    folded.add(key);
  }
  return Object.freeze(result);
}

function sourceSnapshot(files: readonly TWidgetSourceFile[]): TWidgetSourceSnapshot {
  const ordered = immutableFiles(files);
  const digestSha256 = snapshotDigest(ordered);
  return Object.freeze({
    id: digestSha256,
    digestSha256,
    files: ordered,
    // Capture time is deliberately incidental and stable for this generated
    // build tree. It must never defeat exact construction reuse.
    createdAtMs: 0,
  });
}

function releaseFile(file: TWidgetSourceFile): TWidgetReleaseFile {
  return Object.freeze({
    path: file.path,
    byteSize: file.bytes.byteLength,
    sha256: sha256(file.bytes),
  });
}

function directoryDigest(
  files: readonly TWidgetSourceFile[],
  prefix: string,
): string {
  return fnWidgetReleaseDirectoryDigest({
    files: files.map((file) => ({
      path: file.path.slice(prefix.length),
      byteSize: file.bytes.byteLength,
      sha256: sha256(file.bytes),
    })),
    digestSha256: sha256,
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Filesystem-first build edge. Authored presentation never enters the staged
 * build tree; the injected Capsule constructor receives only source bytes and
 * `.omnidraw/build-manifest.json` with the executable projection.
 */
export class WidgetFilesystemBuildService {
  constructor(readonly config: TWidgetFilesystemBuildServiceConfig) {}

  async construct(
    request: TWidgetFilesystemConstructionRequest,
  ): Promise<TWidgetFilesystemConstruction> {
    const manifest = ZWidgetManifestV4.parse(request.manifest);
    const environment = Object.freeze({
      ...this.config.environment,
      serverRuntimeAbi: manifest.server?.runtimeAbi ?? null,
    });

    const executableInputDigestSha256 = fnWidgetExecutableInputDigest({
      manifest,
      files: request.files,
      environment,
      digestSha256: sha256,
    });
    if (
      request.expectedExecutableInputDigestSha256 !== undefined
      && request.expectedExecutableInputDigestSha256 !== executableInputDigestSha256
    ) throw new Error('Widget source changed after the executable-input fence was selected.');

    const executableProjection = fnProjectWidgetExecutableManifest(manifest);
    const canonicalExecutableManifestJson = fnCanonicalizeWidgetExecutableProjection(executableProjection);
    const executableManifestDigestSha256 = fnWidgetExecutableManifestDigest({
      manifest,
      digestSha256: sha256,
    });
    const stagedFiles = immutableFiles([
      ...request.files,
      Object.freeze({
        path: GENERATED_BUILD_MANIFEST_PATH,
        bytes: new TextEncoder().encode(canonicalExecutableManifestJson),
      }),
    ]);
    const construction = await this.config.construction.construct({
      snapshot: sourceSnapshot(stagedFiles),
      manifest: executableProjection,
      canonicalManifestJson: fnCanonicalizeWidgetExecutableProjection(executableProjection),
      builderIdentity: this.config.builderIdentity,
      capsuleBuildIdentity: this.config.environment.capsuleBuildIdentity,
      buildPolicyId: this.config.environment.buildPolicyId,
      ...(request.workspaceKey === undefined ? {} : { workspaceKey: request.workspaceKey }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.reportProgress === undefined
        ? {}
        : { reportProgress: request.reportProgress }),
    });
    if (construction.distributionFiles === undefined) {
      throw new Error('Widget Capsule constructor did not retain the exact browser distribution.');
    }
    const distFiles = immutableFiles(construction.distributionFiles.map((file) => ({
      path: `dist/${file.path}`,
      bytes: file.bytes,
    })));
    if (distFiles.length === 0) throw new Error('Widget build produced no browser distribution.');
    return Object.freeze({
      executableInputDigestSha256,
      executableManifestDigestSha256,
      canonicalExecutableManifestJson,
      distributionDigestSha256: directoryDigest(distFiles, 'dist/'),
      construction,
      distFiles,
    });
  }

  async sign(
    construction: TWidgetFilesystemConstruction,
    purpose: 'preview' | 'release',
  ): Promise<TWidgetFilesystemSignedConstruction> {
    const build = await this.config.construction.signConstruction({
      construction: construction.construction,
      signingPurpose: purpose,
    });
    const inspected = await this.config.capsuleInspector.inspect(build.uiArtifact.bytes);
    if (
      inspected.artifactHash !== build.uiArtifact.capsuleArtifactHash
      || !sameValue(inspected.runtime, build.uiArtifact.runtimeDescriptor)
      || inspected.artifactHash !== construction.construction.uiArtifact.capsuleArtifactHash
    ) throw new Error('Signed Capsule bytes failed exact host inspection.');
    return Object.freeze({
      executableInputDigestSha256: construction.executableInputDigestSha256,
      executableManifestDigestSha256: construction.executableManifestDigestSha256,
      build,
      capsule: Object.freeze({
        artifactBytes: new Uint8Array(build.uiArtifact.bytes),
        artifactHash: inspected.artifactHash,
        runtime: inspected.runtime,
      }),
    });
  }

  async preparePublication(args: Readonly<{
    manifest: import('@omnidraw/widget-contract').TWidgetManifestV4;
    construction: TWidgetFilesystemConstruction;
  }>): Promise<TWidgetFilesystemPreparedPublication> {
    const manifest = ZWidgetManifestV4.parse(args.manifest);
    const browserFiles = immutableFiles(args.construction.distFiles);
    if (
      directoryDigest(browserFiles, 'dist/')
        !== args.construction.distributionDigestSha256
    ) throw new Error('Widget browser distribution changed after construction.');
    const expectedExecutableManifestDigestSha256 = fnWidgetExecutableManifestDigest({
      manifest,
      digestSha256: sha256,
    });
    if (
      expectedExecutableManifestDigestSha256
        !== args.construction.executableManifestDigestSha256
    ) throw new Error('Widget manifest executable fields changed after construction.');

    const signed = await this.sign(args.construction, 'release');
    const capsuleFile = Object.freeze({
      path: 'capsule.artifact',
      bytes: new Uint8Array(signed.capsule.artifactBytes),
    });
    const serverArtifact = signed.build.serverArtifact;
    let server: TWidgetFilesystemPreparedPublication['server'] = null;
    const runtimeFiles: TWidgetSourceFile[] = [...browserFiles, capsuleFile];
    if (serverArtifact !== null) {
      const serverFiles = immutableFiles([{
        path: SERVER_ARTIFACT_PATH,
        bytes: new Uint8Array(serverArtifact.bytes),
      }]);
      const functionsJson = fnCanonicalizeWidgetServerFunctionDescriptors(
        signed.build.functionDescriptors,
      );
      const functionsFile = Object.freeze({
        path: 'functions.json',
        bytes: new TextEncoder().encode(functionsJson),
      });
      const relativeServerFiles = serverFiles.map((file) => ({
        path: file.path.slice('server-dist/'.length),
        byteSize: file.bytes.byteLength,
        sha256: sha256(file.bytes),
      }));
      server = Object.freeze({
        files: serverFiles,
        functionsJson,
        serverDistDigestSha256: fnWidgetReleaseDirectoryDigest({
          files: relativeServerFiles,
          digestSha256: sha256,
        }),
      });
      runtimeFiles.push(...serverFiles, functionsFile);
    }
    const files = immutableFiles(runtimeFiles);
    const unsignedRelease = fnCreateWidgetUnsignedReleaseDescriptor({
      executableManifestDigestSha256: expectedExecutableManifestDigestSha256,
      files: files.map(releaseFile),
      capsule: {
        path: 'capsule.artifact',
        artifactHash: signed.capsule.artifactHash,
        runtime: signed.capsule.runtime,
      },
      server: server === null ? null : {
        entry: SERVER_ARTIFACT_PATH,
        runtimeAbi: serverArtifact!.runtimeAbi,
        functionsPath: 'functions.json',
        serverDistDigestSha256: server.serverDistDigestSha256,
        functionsDigestSha256: sha256(new TextEncoder().encode(server.functionsJson)),
      },
    });
    const canonicalUnsignedReleaseJson = fnCanonicalizeWidgetUnsignedReleaseDescriptor(
      unsignedRelease,
    );
    const release = fnCreateWidgetReleaseDescriptor({
      ...unsignedRelease,
      releaseAttestation: await this.config.releaseAttestor.attest(
        canonicalUnsignedReleaseJson,
      ),
    });
    const validation = fnValidateWidgetRelease({
      manifest,
      expectedExecutableManifestDigestSha256,
      release,
      observation: {
        files: files.map(releaseFile),
        capsule: {
          artifactHash: signed.capsule.artifactHash,
          runtime: signed.capsule.runtime,
        },
        server: server === null ? null : {
          serverDistDigestSha256: server.serverDistDigestSha256,
          functionsDigestSha256: sha256(new TextEncoder().encode(server.functionsJson)),
          functions: signed.build.functionDescriptors,
        },
      },
    });
    if (!validation.valid) {
      throw new Error(`Generated widget release failed validation: ${validation.reason}.`);
    }
    return Object.freeze({
      executableInputDigestSha256: args.construction.executableInputDigestSha256,
      manifestJson: fnCanonicalizeWidgetManifestV4(manifest),
      browser: Object.freeze({ files: browserFiles }),
      capsule: Object.freeze({
        artifactBytes: new Uint8Array(signed.capsule.artifactBytes),
        artifactHash: signed.capsule.artifactHash,
        runtime: signed.capsule.runtime,
      }),
      server,
      files,
      release: Object.freeze({
        descriptor: release,
        canonicalJson: fnCanonicalizeWidgetReleaseDescriptor(release),
      }),
    });
  }

  closeWorkspace(workspaceKey: string): Promise<void> {
    return this.config.construction.closeWorkspace?.({ workspaceKey }) ?? Promise.resolve();
  }

  close(): Promise<void> {
    return this.config.construction.close?.() ?? Promise.resolve();
  }
}

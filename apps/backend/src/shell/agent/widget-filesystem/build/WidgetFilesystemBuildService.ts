import { createHash } from 'node:crypto';
import {
  ZWidgetManifestV1,
  WIDGET_SERVER_FUNCTIONS_PATH,
  WIDGET_SERVER_MODULE_ABI,
  WIDGET_SERVER_MODULE_FORMAT,
  WIDGET_SERVER_MODULE_PATH,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV1,
  fnCanonicalizeWidgetReleaseDescriptor,
  fnCanonicalizeWidgetUnsignedReleaseDescriptor,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnCreateWidgetBuildReceipt,
  fnCreateWidgetReleaseDescriptor,
  fnCreateWidgetUnsignedReleaseDescriptor,
  fnNormalizeWidgetFilesystemRelativePath,
  fnValidateWidgetRelease,
  fnWidgetExecutableInputDigest,
  fnWidgetExecutableManifestDigest,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  fnWidgetReleaseDirectoryDigest,
  fnProjectWidgetExecutableManifest,
  type TWidgetReleaseFile,
  type TWidgetSourceArtifact,
  type TWidgetSourceFile,
  type TWidgetSourceSnapshot,
} from '@omnidraw/sdk/contract';
import type {
  TWidgetFilesystemBuildServiceConfig,
  TWidgetFilesystemConstruction,
  TWidgetFilesystemConstructionRequest,
  TWidgetFilesystemPreparedPublication,
  TWidgetFilesystemPortableBuild,
  TWidgetFilesystemSignedConstruction,
} from './typed';
import { WIDGET_PUBLISHED_SOURCE_ARTIFACT_PATH } from './CONSTANTS';

const GENERATED_BUILD_MANIFEST_PATH = '.omnidraw/build-manifest.json';

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

  /** Restores only an exact durable cache entry and never starts construction. */
  async restoreCached(
    request: TWidgetFilesystemConstructionRequest,
  ): Promise<TWidgetFilesystemConstruction | null> {
    const manifest = ZWidgetManifestV1.parse(request.manifest);
    const executableInputDigestSha256 = fnWidgetExecutableInputDigest({
      manifest,
      files: request.files,
      environment: this.config.environment,
      digestSha256: sha256,
    });
    if (
      request.expectedExecutableInputDigestSha256 !== undefined
      && request.expectedExecutableInputDigestSha256 !== executableInputDigestSha256
    ) throw new Error('Widget source changed after the executable-input fence was selected.');
    const cache = this.config.constructionCache;
    if (cache === undefined) return null;
    const cacheKey = this.#constructionCacheKey(executableInputDigestSha256);
    const cached = await cache.read(cacheKey).catch(() => null);
    if (
      cached !== null
      && cached.construction.sourceMapArtifact === null
      && cached.executableInputDigestSha256 === executableInputDigestSha256
      && cached.executableManifestDigestSha256
        === fnWidgetExecutableManifestDigest({ manifest, digestSha256: sha256 })
    ) return cached;
    if (cached !== null && cached.construction.sourceMapArtifact !== null) {
      await cache.delete?.(cacheKey).catch(() => undefined);
    }
    return null;
  }

  async construct(
    request: TWidgetFilesystemConstructionRequest,
  ): Promise<TWidgetFilesystemConstruction> {
    const cached = await this.restoreCached(request);
    if (cached !== null) return cached;
    const manifest = ZWidgetManifestV1.parse(request.manifest);
    const environment = this.config.environment;

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
    const result = Object.freeze({
      executableInputDigestSha256,
      executableManifestDigestSha256,
      canonicalExecutableManifestJson,
      distributionDigestSha256: directoryDigest(distFiles, 'dist/'),
      construction,
      distFiles,
    });
    const writeCache = this.config.constructionCache;
    // The caller keeps the mapped construction; only the restart projection
    // crosses the durable cache boundary.
    const durableConstruction = result.construction.sourceMapArtifact === null
      ? result.construction
      : this.config.construction.prepareDurableCacheConstruction?.(
        result.construction,
      ) ?? null;
    if (
      writeCache !== undefined
      && durableConstruction !== null
      && durableConstruction.sourceMapArtifact === null
    ) {
      await writeCache.write(
        this.#constructionCacheKey(executableInputDigestSha256),
        Object.freeze({
          ...result,
          construction: durableConstruction,
        }),
      ).catch(() => undefined);
    }
    return result;
  }

  /**
   * Runs the portable SDK distribution build through the configured private
   * workspace and returns only immutable `dist/` bytes plus their canonical
   * receipt. The caller remains responsible for source revalidation and
   * atomic projection into the observed draft generation boundary.
   */
  async buildPortable(
    request: TWidgetFilesystemConstructionRequest,
  ): Promise<TWidgetFilesystemPortableBuild> {
    const construction = await this.construct(request);
    const distFiles = immutableFiles(construction.distFiles);
    const receipt = fnCreateWidgetBuildReceipt({
      sourceDigestSha256: fnWidgetPortableSourceDigest({
        files: request.files,
        digestSha256: sha256,
      }),
      manifestDigestSha256: fnWidgetManifestV1Digest({
        manifest: request.manifest,
        digestSha256: sha256,
      }),
      executableInputDigestSha256: fnWidgetPortableExecutableInputDigest({
        manifest: request.manifest,
        files: request.files,
        digestSha256: sha256,
      }),
      sdkVersion: this.config.environment.sdkVersion,
      outputs: distFiles.map((file) => Object.freeze({
        path: file.path,
        byteSize: file.bytes.byteLength,
        sha256: sha256(file.bytes),
      })),
      digestSha256: sha256,
    });
    return Object.freeze({ construction, receipt, distFiles });
  }

  #constructionCacheKey(executableInputDigestSha256: string): string {
    return `${this.config.builderIdentity}\u0000${executableInputDigestSha256}`;
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
      inspected.artifactHash !== build.uiArtifact.artifactHash
      || !sameValue(inspected.runtime, build.uiArtifact.runtimeDescriptor)
      || inspected.artifactHash !== construction.construction.uiArtifact.artifactHash
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
    manifest: import('@omnidraw/sdk/contract').TWidgetManifestV1;
    construction: TWidgetFilesystemConstruction;
  }>): Promise<TWidgetFilesystemPreparedPublication> {
    const manifest = ZWidgetManifestV1.parse(args.manifest);
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
    const sourceArtifact = args.construction.construction.sourceArtifact;
    const sourceArtifactFile = Object.freeze({
      path: WIDGET_PUBLISHED_SOURCE_ARTIFACT_PATH,
      bytes: new Uint8Array(sourceArtifact.bytes),
    });
    const occupiedPaths = new Set(browserFiles.map((file) => file.path.toLowerCase()));
    if (occupiedPaths.has(sourceArtifactFile.path.toLowerCase())) {
      throw new Error('Widget distribution conflicts with the reserved authoring-source artifact.');
    }
    const runtimeFiles: TWidgetSourceFile[] = [
      ...browserFiles,
      sourceArtifactFile,
      capsuleFile,
    ];
    if (serverArtifact !== null) {
      const serverFiles = immutableFiles([{
        path: WIDGET_SERVER_MODULE_PATH,
        bytes: new Uint8Array(serverArtifact.moduleBytes),
      }]);
      const functionsJson = fnCanonicalizeWidgetServerFunctionDescriptors(
        signed.build.functionDescriptors,
      );
      const functionsFile = Object.freeze({
        path: WIDGET_SERVER_FUNCTIONS_PATH,
        bytes: new TextEncoder().encode(functionsJson),
      });
      server = Object.freeze({
        files: serverFiles,
        functionsJson,
        moduleDigestSha256: serverArtifact.moduleDigestSha256,
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
        moduleDigestSha256: server.moduleDigestSha256,
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
          moduleDigestSha256: server.moduleDigestSha256,
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
      manifestJson: fnCanonicalizeWidgetManifestV1(manifest),
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

  decodePublishedSourceArtifact(bytes: Uint8Array): readonly TWidgetSourceFile[] {
    const decode = this.config.construction.decodeSourceArtifact;
    if (decode === undefined) {
      throw new Error('Widget source artifact decoding is unavailable.');
    }
    const artifact: TWidgetSourceArtifact = Object.freeze({
      kind: 'source',
      digestSha256: sha256(bytes),
      bytes: new Uint8Array(bytes),
    });
    const snapshot = decode.call(this.config.construction, artifact);
    return immutableFiles(snapshot.files.filter((file) => (
      file.path !== GENERATED_BUILD_MANIFEST_PATH
      && file.path !== 'omnidraw.json'
    )));
  }

  close(): Promise<void> {
    return this.config.construction.close?.() ?? Promise.resolve();
  }
}

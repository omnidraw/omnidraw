import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  CapsuleBuildOutput,
  CapsuleSnapshotFile,
} from '@omnidraw/capsule/build';
import {
  signCapsuleArtifactBytes,
  type CapsuleArtifactSigningKey,
} from '@omnidraw/capsule/sign';
import {
  ZWidgetExecutableManifest,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetConstructionContractPayload,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnGenerateWidgetServerFunctionClientModule,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  type TWidgetArtifactConstructionRequest,
  type TWidgetArtifactConstructionResult,
  type TWidgetArtifactConstructionSignRequest,
  type TWidgetBuildResult,
  type TWidgetCapsuleBuildIdentity,
  type TWidgetCapsuleCapabilityRequest,
  type TWidgetCapsuleChannelContract,
  type TWidgetCapsuleHash,
  type TWidgetBuildRequest,
  type TWidgetDistributionBuildProvenance,
  type TWidgetServerBuildArtifact,
  type TWidgetServerFunctionDescriptor,
  type TWidgetServerFunctionDescriptorExtractionRequest,
  type TWidgetSourceSnapshot,
} from '#backend/core/widget-domain';
import type {
  IWidgetArtifactConstructionBuilder,
  IWidgetServerFunctionDescriptorExtractor,
} from '#backend/shell/widget';
import {
  WidgetSourceSnapshot,
  fnAttachServerFunctionModulePaths,
  fnGenerateServerFunctionEntrySource,
  fnNormalizeWidgetBuildAllowedPackageImports,
  fnResolveWidgetBuildImport,
  fnWidgetBuildPackageImportAllowedForTarget,
  fnWidgetBuildPathIsServerOnly,
  fnWidgetBuildPathIsSharedSafe,
  fnWidgetBuildSourceHasForbiddenImportSyntax,
  fnWidgetBuildSourceHasRuntimeReExport,
  type TServerFunctionModule,
} from '#backend/shell/widget-domain/local';
import {
  createOmnidrawCollaborativeStateCapabilityContract,
  createOmnidrawGuestChannelContract,
  createOmnidrawServerFunctionCapabilityContract,
} from './create-capability-contracts';
import {
  OMNIDRAW_CAPSULE_ALLOWED_SERVER_IMPORTS,
  OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
  OMNIDRAW_SERVER_ARTIFACT_FORMAT,
} from './CONSTANTS';
import {
  fnOmnidrawCapsuleApis,
  fnOmnidrawCapsuleBudgetRequest,
  fnOmnidrawCapsuleBuildPolicy,
} from './fn.policy';
import {
  OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST,
  OMNIDRAW_CAPSULE_API_CONTRACT_FORMAT,
} from '#backend/shell/widget-runtime/contract/CONSTANTS';
import { fnWidgetBuildError } from './fn.build-error';
import { fnCanonicalizeWidgetSourceMapArtifact } from './fn.source-map-artifact';
import type {
  TOmnidrawCapsuleBuild,
  TOmnidrawDistributionBuild,
} from './interface';
import { signOmnidrawCapsuleArtifact } from './sign-capsule-artifact';

const GENERATED_SERVER_ENTRY = '__omnidraw_server_entry__.ts';
const JAVASCRIPT_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

export type TWidgetArtifactBuilderCapsuleConfig = Readonly<{
  tempRoot: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId?: string;
  snapshotService: WidgetSourceSnapshot;
  functionDescriptorExtractor: IWidgetServerFunctionDescriptorExtractor;
  resolveTrustedPackageImport: (specifier: string) => string;
  loadSigningKeys(
    purpose: 'preview' | 'release',
  ): Promise<readonly CapsuleArtifactSigningKey[]>;
  capsuleBuild: TOmnidrawCapsuleBuild;
  distributionBuild: TOmnidrawDistributionBuild;
  capsuleSign: typeof signCapsuleArtifactBytes;
  bunBuild: typeof Bun.build;
}>;

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSnapshotEntry(snapshot: TWidgetSourceSnapshot, entry: string): void {
  if (!snapshot.files.some((file) => file.path === entry)) {
    throw fnWidgetBuildError('source');
  }
}

function serverGraph(args: Readonly<{
  snapshot: TWidgetSourceSnapshot;
  entry: string;
  allowedImports: readonly string[];
}>): ReadonlySet<string> {
  const files = new Map(args.snapshot.files.map((file) => [file.path, file]));
  const paths = [...files.keys()];
  const transpiler = new Bun.Transpiler({
    loader: 'tsx',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const pending = [args.entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    if (!JAVASCRIPT_SOURCE_PATTERN.test(path)) continue;
    const file = files.get(path);
    if (file === undefined) throw fnWidgetBuildError('server');
    const source = Buffer.from(file.bytes).toString('utf8');
    if (fnWidgetBuildSourceHasForbiddenImportSyntax(source)) throw fnWidgetBuildError('server');
    let imports;
    try {
      imports = transpiler.scanImports(source);
    } catch (cause) {
      throw fnWidgetBuildError('server', cause);
    }
    for (const imported of imports) {
      const resolved = fnResolveWidgetBuildImport({
        importerPath: path,
        specifier: imported.path,
        sourcePaths: paths,
        allowedPackageImports: args.allowedImports,
      });
      if (resolved.kind === 'package') {
        if (!fnWidgetBuildPackageImportAllowedForTarget({
          kind: 'server',
          specifier: resolved.specifier,
          allowedPackageImports: args.allowedImports,
        })) throw fnWidgetBuildError('server');
        continue;
      }
      pending.push(resolved.path);
    }
  }
  return visited;
}

function serverFunctionModules(
  snapshot: TWidgetSourceSnapshot,
  serverGraph: ReadonlySet<string>,
  serverEntry: string,
): readonly TServerFunctionModule[] {
  const files = new Map(snapshot.files.map((file) => [file.path, file]));
  const transpiler = new Bun.Transpiler({ loader: 'tsx' });
  const names = new Set<string>();
  const modules: TServerFunctionModule[] = [];
  for (const path of [...serverGraph].sort()) {
    if (!JAVASCRIPT_SOURCE_PATTERN.test(path) || !fnWidgetBuildPathIsServerOnly(path, serverEntry)) {
      continue;
    }
    const file = files.get(path);
    if (file === undefined) throw fnWidgetBuildError('server');
    const source = Buffer.from(file.bytes).toString('utf8');
    if (fnWidgetBuildSourceHasRuntimeReExport(source)) throw fnWidgetBuildError('server');
    let exports;
    try {
      exports = [...transpiler.scan(source).exports].sort();
    } catch (cause) {
      throw fnWidgetBuildError('server', cause);
    }
    for (const name of exports) {
      if (!EXPORT_NAME_PATTERN.test(name) || names.has(name)) throw fnWidgetBuildError('server');
      names.add(name);
    }
    if (exports.length > 0) modules.push(Object.freeze({ path, exportNames: exports }));
  }
  return Object.freeze(modules);
}

function capsuleHash(digest: string): TWidgetCapsuleHash {
  return `sha256:${digest}`;
}

function serverOutputLoader(loader: string): string {
  return ['js', 'jsx', 'ts', 'tsx'].includes(loader) ? 'js' : loader;
}

function assertBuildActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw Object.assign(new Error('Widget build was superseded.'), {
      code: 'WIDGET_BUILD_SUPERSEDED',
    });
  }
}

/** Orchestrates an injected Capsule UI build and a separate Bun server-function artifact. */
export class WidgetArtifactBuilderCapsule implements IWidgetArtifactConstructionBuilder {
  readonly #snapshotService: WidgetSourceSnapshot;
  readonly #capsuleBuild: TOmnidrawCapsuleBuild;
  readonly #distributionBuild: TOmnidrawDistributionBuild;
  readonly #capsuleSign: typeof signCapsuleArtifactBytes;
  readonly #bunBuild: typeof Bun.build;
  readonly #resolveTrustedPackageImport: (specifier: string) => string;
  readonly #allowedServerImports = fnNormalizeWidgetBuildAllowedPackageImports(
    OMNIDRAW_CAPSULE_ALLOWED_SERVER_IMPORTS,
  );

  constructor(readonly config: TWidgetArtifactBuilderCapsuleConfig) {
    this.#snapshotService = config.snapshotService;
    this.#capsuleBuild = config.capsuleBuild;
    this.#distributionBuild = config.distributionBuild;
    this.#capsuleSign = config.capsuleSign;
    this.#bunBuild = config.bunBuild;
    this.#resolveTrustedPackageImport = config.resolveTrustedPackageImport;
  }

  async build(request: TWidgetBuildRequest): Promise<TWidgetBuildResult> {
    const construction = await this.construct({
      snapshot: request.snapshot,
      manifest: request.manifest,
      canonicalManifestJson: request.canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
    });
    return this.signConstruction({
      construction,
      signingPurpose: request.signingPurpose,
    });
  }

  async construct(
    request: TWidgetArtifactConstructionRequest,
  ): Promise<TWidgetArtifactConstructionResult> {
    assertBuildActive(request.signal);
    const buildPolicyId = this.config.buildPolicyId ?? OMNIDRAW_CAPSULE_BUILD_POLICY_ID;
    if (
      request.builderIdentity !== this.config.builderIdentity
      || JSON.stringify(request.capsuleBuildIdentity)
        !== JSON.stringify(this.config.capsuleBuildIdentity)
      || request.buildPolicyId !== buildPolicyId
    ) {
      throw new Error('Widget build requested an untrusted build identity or policy.');
    }
    const manifest = ZWidgetExecutableManifest.parse(request.manifest);
    if (request.canonicalManifestJson !== fnCanonicalizeWidgetExecutableProjection(manifest)) {
      throw new Error('Widget build canonical manifest does not match the validated manifest.');
    }
    assertSnapshotEntry(request.snapshot, manifest.ui.entry);
    if (manifest.server !== null) assertSnapshotEntry(request.snapshot, manifest.server.entry);

    const serverSourceGraph = manifest.server === null
      ? null
      : serverGraph({
          snapshot: request.snapshot,
          entry: manifest.server.entry,
          allowedImports: this.#allowedServerImports,
        });
    const functionModules = manifest.server === null || serverSourceGraph === null
      ? Object.freeze([])
      : serverFunctionModules(request.snapshot, serverSourceGraph, manifest.server.entry);

    const serverArtifact = manifest.server === null
      ? null
      : await this.#buildServer(request.snapshot, manifest.server, functionModules);
    assertBuildActive(request.signal);
    let functionDescriptors: readonly TWidgetServerFunctionDescriptor[] = [];
    if (serverArtifact !== null && manifest.server !== null) {
      const extractionRequest = Object.freeze({
        serverArtifact,
        serverEntry: manifest.server.entry,
        runtimeAbi: manifest.server.runtimeAbi,
      });
      const extracted = await this.config.functionDescriptorExtractor
        .extractServerFunctionDescriptors(extractionRequest);
      functionDescriptors = ZWidgetServerFunctionDescriptors.parse(
        fnAttachServerFunctionModulePaths(extracted, functionModules),
      );
    }
    const validation = fnValidateWidgetServerFunctionDescriptors(manifest, functionDescriptors);
    if (!validation.valid) throw fnWidgetBuildError('server');

    const functionDescriptorsDigestSha256 = sha256(
      fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
    );
    const browserFunctionDescriptors =
      fnProjectWidgetBrowserFunctionDescriptors(functionDescriptors);
    const functions = await createOmnidrawServerFunctionCapabilityContract({
      // The capability binds the exact generated functions.json contract. The
      // browser receives the safe projection, but its selector must still
      // identify the full descriptor file verified by the host.
      descriptorDigestSha256: functionDescriptorsDigestSha256,
      functions: browserFunctionDescriptors,
    });
    const collaborative = manifest.ui.state?.collaborative === true
      ? await createOmnidrawCollaborativeStateCapabilityContract()
      : null;
    const channels = await createOmnidrawGuestChannelContract({
      localStore: manifest.ui.state?.localStore ?? 'none',
    });
    const capabilityContracts = [functions, collaborative].filter(
      (value) => value !== null,
    );
    const capabilityRequests = capabilityContracts.map((value) => value.request);
    const capsuleApis = fnOmnidrawCapsuleApis(manifest.ui.apis);
    const functionModulePaths = new Set(functionModules.map(({ path }) => path));
    // This namespace separation happens before application-owned npm/build
    // execution. Capsule receives only the resulting external distribution.
    const uiFiles: CapsuleSnapshotFile[] = request.snapshot.files
      .filter((file) => !functionModulePaths.has(file.path))
      .filter((file) => !fnWidgetBuildPathIsServerOnly(
        file.path,
        manifest.server?.entry ?? null,
      ))
      .filter((file) => (
        serverSourceGraph === null
        || !serverSourceGraph.has(file.path)
        || fnWidgetBuildPathIsSharedSafe(file.path)
      ))
      .map((file) => Object.freeze({ path: file.path, bytes: new Uint8Array(file.bytes) }));
    if (functions !== null) {
      for (const module of functionModules) {
        const descriptors = functionDescriptors.filter(
          (descriptor) => descriptor.modulePath === module.path,
        );
        uiFiles.push(Object.freeze({
          path: module.path,
          bytes: new TextEncoder().encode(fnGenerateWidgetServerFunctionClientModule({
            descriptors,
            serverModuleSpecifier: `./${module.path}`,
            capabilitySelector: functions.selector,
            includeTypeBindings: false,
          })),
        }));
      }
    }
    const requestedBudgets = fnOmnidrawCapsuleBudgetRequest(
      manifest.ui.budgets ?? {},
    );
    let distributionInput: Awaited<ReturnType<TOmnidrawDistributionBuild>>;
    let built: CapsuleBuildOutput;
    try {
      distributionInput = await this.#distributionBuild({
        sourceRevision: request.snapshot.digestSha256,
        entry: manifest.ui.entry,
        files: Object.freeze(uiFiles),
        executableManifest: manifest,
        ...(request.workspaceKey === undefined ? {} : { workspaceKey: request.workspaceKey }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.reportProgress === undefined
          ? {}
          : {
              reportProgress: (phase) => request.reportProgress?.(phase),
            }),
      });
      assertBuildActive(request.signal);
      request.reportProgress?.('validating');
      const {
        sourceMaps: _sourceMaps,
        ...capsuleDistributionInput
      } = distributionInput;
      built = await this.#capsuleBuild({
        input: capsuleDistributionInput,
        apis: capsuleApis,
        capabilityRequests,
        guestChannels: channels.declaration,
        parkability: { parkable: false },
        ...(Object.keys(requestedBudgets).length === 0
          ? {}
          : { budgets: requestedBudgets }),
        policy: fnOmnidrawCapsuleBuildPolicy(),
      });
      assertBuildActive(request.signal);
    } catch (cause) {
      throw fnWidgetBuildError('ui', cause);
    }
    const runtimeDescriptor = Object.freeze({
      format: 'omnidraw.capsule-runtime.v2' as const,
      capsuleArtifactHash: built.artifactHash,
      apiContract: Object.freeze({
        format: OMNIDRAW_CAPSULE_API_CONTRACT_FORMAT,
        groups: Object.freeze([...capsuleApis]),
        bundleDigest: OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST,
      }),
      budgets: requestedBudgets,
      capabilityRequests: capabilityRequests as readonly TWidgetCapsuleCapabilityRequest[],
      channels: channels.declaration as TWidgetCapsuleChannelContract,
      parkability: Object.freeze({ parkable: false as const }),
    });
    const capabilityContractDigestSha256 = sha256(
      fnCanonicalizeWidgetCapsuleCapabilityRequests(runtimeDescriptor.capabilityRequests),
    );
    const channelContractDigestSha256 = sha256(
      fnCanonicalizeWidgetCapsuleChannelContract(runtimeDescriptor.channels),
    );
    const sourceArtifact = this.#snapshotService.encodeArtifact(request.snapshot, {
      builderIdentity: request.builderIdentity,
    });
    const sourceMapArtifact = this.#sourceMapArtifact({
      sourceRevision: request.snapshot.digestSha256,
      capsuleArtifactHash: built.artifactHash,
      authoredPaths: request.snapshot.files.map((file) => file.path),
      generatedModules: distributionInput.snapshot.files.map((file) => file.path),
      sourceMaps: distributionInput.sourceMaps ?? [],
    });
    const unsignedUiDigestSha256 = sha256(built.artifactBytes);
    const distributionProvenance = Object.freeze({
      kind: distributionInput.kind,
      producer: Object.freeze({ ...distributionInput.producer }),
      sourceRevision: distributionInput.sourceRevision,
      dependencyLockDigest: distributionInput.dependencyLockDigest,
      buildConfigurationDigest: distributionInput.buildConfigurationDigest,
    }) satisfies TWidgetDistributionBuildProvenance;
    const constructionContractDigestSha256 = sha256(
      fnCanonicalizeWidgetConstructionContractPayload({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        sourceArtifactDigestSha256: sourceArtifact.digestSha256,
        sourceMapArtifactDigestSha256: sourceMapArtifact?.digestSha256 ?? null,
        canonicalManifestJson: request.canonicalManifestJson,
        unsignedUiDigestSha256,
        capsuleArtifactHash: built.artifactHash,
        apiContract: runtimeDescriptor.apiContract,
        budgets: runtimeDescriptor.budgets,
        capabilityContractDigestSha256,
        channelContractDigestSha256,
        serverDigestSha256: serverArtifact?.digestSha256 ?? null,
        serverRuntimeAbi: serverArtifact?.runtimeAbi ?? null,
        functionDescriptorsDigestSha256,
        builderIdentity: request.builderIdentity,
        capsuleBuildIdentity: request.capsuleBuildIdentity,
        buildPolicyId,
        distributionProvenance,
      }),
    );
    return Object.freeze({
      sourceSnapshotId: request.snapshot.id,
      sourceDigestSha256: request.snapshot.digestSha256,
      sourceArtifact,
      sourceMapArtifact,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId,
      canonicalManifestJson: request.canonicalManifestJson,
      distributionProvenance,
      distributionFiles: Object.freeze(distributionInput.snapshot.files.map((file) => Object.freeze({
        path: file.path,
        bytes: new Uint8Array(file.bytes),
      }))),
      functionDescriptors,
      functionDescriptorsDigestSha256,
      capabilityContractDigestSha256,
      channelContractDigestSha256,
      constructionContractDigestSha256,
      uiArtifact: Object.freeze({
        kind: 'unsigned-ui' as const,
        digestSha256: unsignedUiDigestSha256,
        unsignedBytes: new Uint8Array(built.artifactBytes),
        capsuleArtifactHash: built.artifactHash,
        runtimeDescriptor,
        builderIdentity: request.builderIdentity,
        capsuleBuildIdentity: request.capsuleBuildIdentity,
      }),
      serverArtifact,
      diagnostics: Object.freeze(built.diagnostics.map((item) => Object.freeze({ ...item }))),
    });
  }

  async signConstruction(
    request: TWidgetArtifactConstructionSignRequest,
  ): Promise<TWidgetBuildResult> {
    const construction = request.construction;
    this.#assertTrustedConstruction(construction);
    const signed = await signOmnidrawCapsuleArtifact({
      loadKeys: this.config.loadSigningKeys,
      sign: async (bytes, keys) => await this.#capsuleSign(bytes, keys),
    }, {
      bytes: construction.uiArtifact.unsignedBytes,
      capsuleArtifactHash: construction.uiArtifact.capsuleArtifactHash,
      purpose: request.signingPurpose,
    });
    const runtimeDescriptor = Object.freeze({
      ...construction.uiArtifact.runtimeDescriptor,
      signatureKeyIds: signed.signatureKeyIds,
    });
    const uiDigestSha256 = sha256(signed.signedBytes);
    const contractDigestSha256 = sha256(fnCanonicalizeWidgetContractPayload({
      canonicalManifestJson: construction.canonicalManifestJson,
      uiDigestSha256,
      capsuleArtifactHash: runtimeDescriptor.capsuleArtifactHash,
      apiContract: runtimeDescriptor.apiContract,
      budgets: runtimeDescriptor.budgets,
      capabilityContractDigestSha256: construction.capabilityContractDigestSha256,
      channelContractDigestSha256: construction.channelContractDigestSha256,
      signatureKeyIds: runtimeDescriptor.signatureKeyIds,
      serverDigestSha256: construction.serverArtifact?.digestSha256 ?? null,
      serverRuntimeAbi: construction.serverArtifact?.runtimeAbi ?? null,
      functionDescriptorsDigestSha256: construction.functionDescriptorsDigestSha256,
      sourceDigestSha256: construction.sourceDigestSha256,
      builderIdentity: construction.builderIdentity,
      capsuleBuildIdentity: construction.capsuleBuildIdentity,
      buildPolicyId: construction.buildPolicyId,
    }));
    return Object.freeze({
      sourceSnapshotId: construction.sourceSnapshotId,
      sourceDigestSha256: construction.sourceDigestSha256,
      builderIdentity: construction.builderIdentity,
      capsuleBuildIdentity: construction.capsuleBuildIdentity,
      buildPolicyId: construction.buildPolicyId,
      canonicalManifestJson: construction.canonicalManifestJson,
      constructionContractDigestSha256: construction.constructionContractDigestSha256,
      distributionProvenance: construction.distributionProvenance,
      ...(construction.distributionFiles === undefined
        ? {}
        : { distributionFiles: construction.distributionFiles }),
      functionDescriptors: construction.functionDescriptors,
      functionDescriptorsDigestSha256: construction.functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: construction.capabilityContractDigestSha256,
      channelContractDigestSha256: construction.channelContractDigestSha256,
      contractDigestSha256,
      uiArtifact: Object.freeze({
        kind: 'ui' as const,
        digestSha256: uiDigestSha256,
        bytes: signed.signedBytes,
        capsuleArtifactHash: construction.uiArtifact.capsuleArtifactHash,
        runtimeDescriptor,
        builderIdentity: construction.builderIdentity,
        capsuleBuildIdentity: construction.capsuleBuildIdentity,
      }),
      sourceMapArtifact: construction.sourceMapArtifact,
      serverArtifact: construction.serverArtifact,
      diagnostics: construction.diagnostics,
    });
  }

  async closeWorkspace(
    request: Readonly<{ workspaceKey: string }>,
  ): Promise<void> {
    await this.#distributionBuild.closeWorkspace?.(request.workspaceKey);
  }

  async close(): Promise<void> {
    await this.#distributionBuild.close?.();
  }

  #assertTrustedConstruction(construction: TWidgetArtifactConstructionResult): void {
    const buildPolicyId = this.config.buildPolicyId ?? OMNIDRAW_CAPSULE_BUILD_POLICY_ID;
    if (
      construction.builderIdentity !== this.config.builderIdentity
      || JSON.stringify(construction.capsuleBuildIdentity)
        !== JSON.stringify(this.config.capsuleBuildIdentity)
      || construction.buildPolicyId !== buildPolicyId
      || construction.uiArtifact.kind !== 'unsigned-ui'
      || construction.uiArtifact.builderIdentity !== construction.builderIdentity
      || JSON.stringify(construction.uiArtifact.capsuleBuildIdentity)
        !== JSON.stringify(construction.capsuleBuildIdentity)
      || construction.uiArtifact.capsuleArtifactHash
        !== construction.uiArtifact.runtimeDescriptor.capsuleArtifactHash
      || construction.distributionProvenance.sourceRevision
        !== construction.sourceDigestSha256
      || sha256(construction.uiArtifact.unsignedBytes)
        !== construction.uiArtifact.digestSha256
      || (
        construction.sourceMapArtifact !== null
        && sha256(construction.sourceMapArtifact.bytes)
          !== construction.sourceMapArtifact.digestSha256
      )
    ) {
      throw new Error('Widget construction requested an untrusted build identity or policy.');
    }
    let manifest;
    try {
      manifest = ZWidgetExecutableManifest.parse(JSON.parse(construction.canonicalManifestJson));
    } catch (cause) {
      throw new Error('Widget construction canonical manifest is invalid.', { cause });
    }
    if (
      construction.canonicalManifestJson !== fnCanonicalizeWidgetExecutableProjection(manifest)
      || JSON.stringify(construction.uiArtifact.runtimeDescriptor.apiContract.groups)
        !== JSON.stringify(manifest.ui.apis)
      || JSON.stringify(construction.uiArtifact.runtimeDescriptor.budgets)
        !== JSON.stringify(manifest.ui.budgets ?? {})
      || (manifest.server === null) !== (construction.serverArtifact === null)
      || (
        construction.serverArtifact !== null
        && construction.serverArtifact.runtimeAbi !== manifest.server?.runtimeAbi
      )
    ) {
      throw new Error('Widget construction metadata failed integrity validation.');
    }
    this.#snapshotService.decodeArtifact(construction.sourceArtifact, {
      expectedSnapshotId: construction.sourceSnapshotId,
      expectedSourceDigestSha256: construction.sourceDigestSha256,
      expectedBuilderIdentity: construction.builderIdentity,
    });
    if (
      construction.serverArtifact !== null
      && sha256(construction.serverArtifact.bytes)
        !== construction.serverArtifact.digestSha256
    ) {
      throw new Error('Widget construction server artifact failed integrity validation.');
    }
    const descriptorValidation = fnValidateWidgetServerFunctionDescriptors(
      manifest,
      construction.functionDescriptors,
    );
    if (
      !descriptorValidation.valid
      || sha256(fnCanonicalizeWidgetServerFunctionDescriptors(
        construction.functionDescriptors,
      )) !== construction.functionDescriptorsDigestSha256
      || sha256(fnCanonicalizeWidgetCapsuleCapabilityRequests(
        construction.uiArtifact.runtimeDescriptor.capabilityRequests,
      )) !== construction.capabilityContractDigestSha256
      || sha256(fnCanonicalizeWidgetCapsuleChannelContract(
        construction.uiArtifact.runtimeDescriptor.channels,
      )) !== construction.channelContractDigestSha256
      || sha256(fnCanonicalizeWidgetConstructionContractPayload({
        sourceSnapshotId: construction.sourceSnapshotId,
        sourceDigestSha256: construction.sourceDigestSha256,
        sourceArtifactDigestSha256: construction.sourceArtifact.digestSha256,
        sourceMapArtifactDigestSha256:
          construction.sourceMapArtifact?.digestSha256 ?? null,
        canonicalManifestJson: construction.canonicalManifestJson,
        unsignedUiDigestSha256: construction.uiArtifact.digestSha256,
        capsuleArtifactHash: construction.uiArtifact.capsuleArtifactHash,
        apiContract: construction.uiArtifact.runtimeDescriptor.apiContract,
        budgets: construction.uiArtifact.runtimeDescriptor.budgets,
        capabilityContractDigestSha256: construction.capabilityContractDigestSha256,
        channelContractDigestSha256: construction.channelContractDigestSha256,
        serverDigestSha256: construction.serverArtifact?.digestSha256 ?? null,
        serverRuntimeAbi: construction.serverArtifact?.runtimeAbi ?? null,
        functionDescriptorsDigestSha256: construction.functionDescriptorsDigestSha256,
        builderIdentity: construction.builderIdentity,
        capsuleBuildIdentity: construction.capsuleBuildIdentity,
        buildPolicyId: construction.buildPolicyId,
        distributionProvenance: construction.distributionProvenance,
      })) !== construction.constructionContractDigestSha256
    ) {
      throw new Error('Widget construction contract failed integrity validation.');
    }
  }

  #sourceMapArtifact(args: Readonly<{
    sourceRevision: string;
    capsuleArtifactHash: TWidgetCapsuleHash;
    authoredPaths: readonly string[];
    generatedModules: readonly string[];
    sourceMaps: readonly Readonly<{ module: string; bytes: Uint8Array }>[];
  }>): import('#backend/core/widget-domain').TWidgetSourceMapArtifact | null {
    if (args.sourceMaps.length === 0) return null;
    const generatedModules = new Set(args.generatedModules);
    if (args.sourceMaps.some(({ module, bytes }) => (
      !generatedModules.has(module)
      || bytes.byteLength < 1
      || bytes.byteLength > 4 * 1024 * 1024
    ))) {
      throw fnWidgetBuildError('ui');
    }
    const canonical = fnCanonicalizeWidgetSourceMapArtifact({
      sourceRevision: args.sourceRevision,
      capsuleArtifactHash: args.capsuleArtifactHash,
      authoredPaths: args.authoredPaths,
      maps: args.sourceMaps.map(({ module, bytes }) => Object.freeze({
        module,
        mapBase64: Buffer.from(bytes).toString('base64'),
      })),
    });
    const bytes = new TextEncoder().encode(canonical);
    if (bytes.byteLength > 16 * 1024 * 1024) throw fnWidgetBuildError('ui');
    return Object.freeze({
      kind: 'source_map',
      digestSha256: sha256(bytes),
      bytes,
    });
  }

  async #buildServer(
    snapshot: TWidgetSourceSnapshot,
    server: Readonly<{ entry: string; runtimeAbi: string }>,
    functionModules: readonly TServerFunctionModule[],
  ): Promise<TWidgetServerBuildArtifact> {
    await mkdir(this.config.tempRoot, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(join(this.config.tempRoot, 'capsule-server-'));
    try {
      await this.#snapshotService.materialize(snapshot, root);
      const generated = join(root, GENERATED_SERVER_ENTRY);
      await writeFile(
        generated,
        fnGenerateServerFunctionEntrySource(server.entry, functionModules),
        { flag: 'wx', mode: 0o600 },
      );
      const result = await this.#bunBuild({
        entrypoints: [generated],
        root,
        target: 'bun',
        format: 'esm',
        splitting: false,
        sourcemap: 'none',
        minify: true,
        packages: 'bundle',
        allowUnresolved: [],
        env: 'disable',
        plugins: [{
          name: 'omnidraw-capsule-server-imports',
          setup: (builder) => {
            builder.onResolve({ filter: /.*/ }, (args) => {
              if (args.importer.length === 0) return undefined;
              if (args.path.startsWith('.') || args.path.startsWith('/')) return undefined;
              if (!this.#allowedServerImports.includes(args.path)) throw fnWidgetBuildError('server');
              return { path: this.#resolveTrustedPackageImport(args.path) };
            });
          },
        }],
      });
      if (!result.success) throw fnWidgetBuildError('server');
      const outputs = [];
      for (const [index, output] of [...result.outputs].sort((left, right) => (
        basename(left.path).localeCompare(basename(right.path))
      )).entries()) {
        const bytes = new Uint8Array(await output.arrayBuffer());
        const loader = serverOutputLoader(output.loader);
        const source = loader === 'js' ? Buffer.from(bytes).toString('utf8') : '';
        if (source !== '' && fnWidgetBuildSourceHasForbiddenImportSyntax(source)) {
          throw fnWidgetBuildError('server');
        }
        outputs.push(Object.freeze({
          path: `output-${index}.${loader === 'file' ? 'bin' : loader}`,
          loader,
          kind: output.kind,
          digestSha256: sha256(bytes),
          bytesBase64: Buffer.from(bytes).toString('base64'),
        }));
      }
      const bytes = new TextEncoder().encode(JSON.stringify({
        format: OMNIDRAW_SERVER_ARTIFACT_FORMAT,
        kind: 'server',
        entry: server.entry,
        sourceDigestSha256: snapshot.digestSha256,
        builderIdentity: this.config.builderIdentity,
        runtimeAbi: server.runtimeAbi,
        outputs,
      }));
      return Object.freeze({
        kind: 'server',
        digestSha256: sha256(bytes),
        bytes,
        runtimeAbi: server.runtimeAbi,
      });
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'WIDGET_BUILD_FAILED') {
        throw cause;
      }
      throw fnWidgetBuildError('server', cause);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

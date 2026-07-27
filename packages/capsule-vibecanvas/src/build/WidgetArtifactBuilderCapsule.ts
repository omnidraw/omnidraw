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
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV3,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnGenerateWidgetServerFunctionClientModule,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  type IWidgetArtifactBuilder,
  type IWidgetServerFunctionDescriptorExtractor,
  type TWidgetBuildResult,
  type TWidgetCapsuleBuildIdentity,
  type TWidgetCapsuleCapabilityRequest,
  type TWidgetCapsuleChannelContract,
  type TWidgetCapsuleHash,
  type TWidgetBuildRequest,
  type TWidgetServerBuildArtifact,
  type TWidgetServerFunctionDescriptor,
  type TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
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
} from '@vibecanvas/widget-contract/local';
import {
  createVibecanvasCollaborativeStateCapabilityContract,
  createVibecanvasGuestChannelContract,
  createVibecanvasServerFunctionCapabilityContract,
} from '../capabilities/create-capability-contracts';
import {
  VIBECANVAS_CAPSULE_ALLOWED_SERVER_IMPORTS,
  VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
  VIBECANVAS_SERVER_ARTIFACT_FORMAT,
} from './CONSTANTS';
import {
  fnResolveVibecanvasCapsuleBudgets,
  fnVibecanvasCapsuleBuildPolicy,
  fnVibecanvasCapsuleBuildTarget,
} from './fn.policy';
import { fnWidgetBuildError } from './fn.build-error';
import type {
  TVibecanvasCapsuleBuild,
  TVibecanvasDistributionBuild,
} from './interface';
import { txSignVibecanvasCapsuleArtifact } from './tx.sign-capsule-artifact';

const GENERATED_SERVER_ENTRY = '__vibecanvas_server_entry__.ts';
const JAVASCRIPT_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

export type TWidgetArtifactBuilderCapsuleConfig = Readonly<{
  tempRoot: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId?: string;
  snapshotService?: WidgetSourceSnapshot;
  functionDescriptorExtractor: IWidgetServerFunctionDescriptorExtractor;
  resolveTrustedPackageImport?: (specifier: string) => string;
  loadSigningKeys(
    purpose: 'preview' | 'release',
  ): Promise<readonly CapsuleArtifactSigningKey[]>;
  capsuleBuild: TVibecanvasCapsuleBuild;
  distributionBuild: TVibecanvasDistributionBuild;
  capsuleSign?: typeof signCapsuleArtifactBytes;
  bunBuild?: typeof Bun.build;
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

/** Orchestrates an injected Capsule UI build and a separate Bun server-function artifact. */
export class WidgetArtifactBuilderCapsule implements IWidgetArtifactBuilder {
  readonly #snapshotService: WidgetSourceSnapshot;
  readonly #capsuleBuild: TVibecanvasCapsuleBuild;
  readonly #distributionBuild: TVibecanvasDistributionBuild;
  readonly #capsuleSign: typeof signCapsuleArtifactBytes;
  readonly #bunBuild: typeof Bun.build;
  readonly #resolveTrustedPackageImport: (specifier: string) => string;
  readonly #allowedServerImports = fnNormalizeWidgetBuildAllowedPackageImports(
    VIBECANVAS_CAPSULE_ALLOWED_SERVER_IMPORTS,
  );

  constructor(readonly config: TWidgetArtifactBuilderCapsuleConfig) {
    this.#snapshotService = config.snapshotService ?? new WidgetSourceSnapshot();
    this.#capsuleBuild = config.capsuleBuild;
    this.#distributionBuild = config.distributionBuild;
    this.#capsuleSign = config.capsuleSign ?? signCapsuleArtifactBytes;
    this.#bunBuild = config.bunBuild ?? Bun.build;
    this.#resolveTrustedPackageImport = config.resolveTrustedPackageImport
      ?? ((specifier) => Bun.resolveSync(specifier, import.meta.dir));
  }

  async build(
    tenant: TTenantContext,
    request: TWidgetBuildRequest,
  ): Promise<TWidgetBuildResult> {
    const buildPolicyId = this.config.buildPolicyId ?? VIBECANVAS_CAPSULE_BUILD_POLICY_ID;
    if (
      request.builderIdentity !== this.config.builderIdentity
      || JSON.stringify(request.capsuleBuildIdentity)
        !== JSON.stringify(this.config.capsuleBuildIdentity)
      || request.buildPolicyId !== buildPolicyId
    ) {
      throw new Error('Widget build requested an untrusted build identity or policy.');
    }
    const manifest = ZWidgetManifestV3.parse(request.manifest);
    if (request.canonicalManifestJson !== fnCanonicalizeWidgetManifest(manifest)) {
      throw new Error('Widget build canonical manifest does not match the validated manifest.');
    }
    assertSnapshotEntry(request.snapshot, manifest.ui.entry);
    if (manifest.server !== undefined) assertSnapshotEntry(request.snapshot, manifest.server.entry);

    const serverSourceGraph = manifest.server === undefined
      ? null
      : serverGraph({
          snapshot: request.snapshot,
          entry: manifest.server.entry,
          allowedImports: this.#allowedServerImports,
        });
    const functionModules = manifest.server === undefined || serverSourceGraph === null
      ? Object.freeze([])
      : serverFunctionModules(request.snapshot, serverSourceGraph, manifest.server.entry);

    const serverArtifact = manifest.server === undefined
      ? null
      : await this.#buildServer(request.snapshot, manifest.server, functionModules);
    let functionDescriptors: readonly TWidgetServerFunctionDescriptor[] = [];
    if (serverArtifact !== null && manifest.server !== undefined) {
      const extracted = await this.config.functionDescriptorExtractor
        .extractServerFunctionDescriptors(tenant, {
          serverArtifact,
          serverEntry: manifest.server.entry,
          runtimeAbi: manifest.server.runtimeAbi,
        });
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
    const browserFunctionDescriptorsDigestSha256 = sha256(
      fnCanonicalizeWidgetBrowserFunctionDescriptors(browserFunctionDescriptors),
    );
    const functions = await createVibecanvasServerFunctionCapabilityContract({
      descriptorDigestSha256: browserFunctionDescriptorsDigestSha256,
      functions: browserFunctionDescriptors,
    });
    const collaborative = manifest.ui.state?.collaborative === true
      ? await createVibecanvasCollaborativeStateCapabilityContract()
      : null;
    const channels = await createVibecanvasGuestChannelContract({
      localStore: manifest.ui.state?.localStore ?? 'none',
    });
    const capabilityContracts = [functions, collaborative].filter(
      (value) => value !== null,
    );
    const capabilityRequests = capabilityContracts.map((value) => value.request);
    const capsuleTarget = fnVibecanvasCapsuleBuildTarget({
      target: manifest.ui.target,
      entry: manifest.ui.entry,
    });
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
    const effectiveBudgets = fnResolveVibecanvasCapsuleBudgets(
      manifest.ui.budgets ?? {},
    );
    let built: CapsuleBuildOutput;
    try {
      const input = await this.#distributionBuild({
        sourceRevision: request.snapshot.digestSha256,
        entry: manifest.ui.entry,
        files: Object.freeze(uiFiles),
      });
      built = await this.#capsuleBuild({
        input,
        target: capsuleTarget,
        capabilityRequests,
        guestChannels: channels.declaration,
        parkability: { parkable: false },
        requestedBudgets: manifest.ui.budgets ?? {},
        policy: fnVibecanvasCapsuleBuildPolicy(),
      });
    } catch (cause) {
      throw fnWidgetBuildError('ui', cause);
    }
    const signed = await txSignVibecanvasCapsuleArtifact({
      loadKeys: this.config.loadSigningKeys,
      sign: async (bytes, keys) => await this.#capsuleSign(bytes, keys),
    }, {
      bytes: built.artifactBytes,
      capsuleArtifactHash: built.artifactHash,
      purpose: request.signingPurpose,
    });
    const runtimeDescriptor = Object.freeze({
      format: 'vibecanvas.capsule-runtime.v1' as const,
      capsuleArtifactHash: built.artifactHash,
      target: manifest.ui.target,
      budgets: effectiveBudgets,
      capabilityRequests: capabilityRequests as readonly TWidgetCapsuleCapabilityRequest[],
      channels: channels.declaration as TWidgetCapsuleChannelContract,
      parkability: Object.freeze({ parkable: false as const }),
      signatureKeyIds: signed.signatureKeyIds,
    });
    const uiDigestSha256 = sha256(signed.signedBytes);
    const capabilityContractDigestSha256 = sha256(
      fnCanonicalizeWidgetCapsuleCapabilityRequests(runtimeDescriptor.capabilityRequests),
    );
    const channelContractDigestSha256 = sha256(
      fnCanonicalizeWidgetCapsuleChannelContract(runtimeDescriptor.channels),
    );
    const contractDigestSha256 = sha256(fnCanonicalizeWidgetContractPayload({
      canonicalManifestJson: request.canonicalManifestJson,
      uiDigestSha256,
      capsuleArtifactHash: runtimeDescriptor.capsuleArtifactHash,
      target: runtimeDescriptor.target,
      budgets: runtimeDescriptor.budgets,
      capabilityContractDigestSha256,
      channelContractDigestSha256,
      signatureKeyIds: runtimeDescriptor.signatureKeyIds,
      serverDigestSha256: serverArtifact?.digestSha256 ?? null,
      serverRuntimeAbi: serverArtifact?.runtimeAbi ?? null,
      functionDescriptorsDigestSha256,
      sourceDigestSha256: request.snapshot.digestSha256,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId,
    }));
    return Object.freeze({
      sourceSnapshotId: request.snapshot.id,
      sourceDigestSha256: request.snapshot.digestSha256,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId,
      canonicalManifestJson: request.canonicalManifestJson,
      functionDescriptors,
      functionDescriptorsDigestSha256,
      capabilityContractDigestSha256,
      channelContractDigestSha256,
      contractDigestSha256,
      uiArtifact: Object.freeze({
        kind: 'ui' as const,
        digestSha256: uiDigestSha256,
        bytes: signed.signedBytes,
        capsuleArtifactHash: built.artifactHash,
        runtimeDescriptor,
        requestedBudgets: manifest.ui.budgets ?? {},
        effectiveBudgets,
        builderIdentity: request.builderIdentity,
        capsuleBuildIdentity: request.capsuleBuildIdentity,
      }),
      serverArtifact,
      diagnostics: Object.freeze(built.diagnostics.map((item) => Object.freeze({ ...item }))),
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
          name: 'vibecanvas-capsule-server-imports',
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
        format: VIBECANVAS_SERVER_ARTIFACT_FORMAT,
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

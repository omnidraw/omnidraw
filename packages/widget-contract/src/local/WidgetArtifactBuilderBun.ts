import { createHash } from 'node:crypto';
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV2,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnGenerateWidgetServerFunctionClientModule,
  fnValidateWidgetServerFunctionDescriptors,
} from '..';
import type {
  IWidgetArtifactBuilder,
  IWidgetServerFunctionDescriptorExtractor,
  TWidgetBuildArtifact,
  TWidgetBuildArtifactKind,
  TWidgetBuildRequest,
  TWidgetBuildResult,
  TWidgetServerFunctionDescriptor,
  TWidgetSourceSnapshot,
} from '..';
import {
  WIDGET_BUILD_DEFAULT_ALLOWED_SERVER_PACKAGE_IMPORTS,
  WIDGET_BUILD_DEFAULT_ALLOWED_UI_PACKAGE_IMPORTS,
} from './CONSTANTS';
import {
  fnNormalizeWidgetBuildAllowedPackageImports,
  fnResolveWidgetBuildImport,
  fnWidgetBuildPackageImportAllowedForTarget,
  fnWidgetBuildPathIsServerOnly,
  fnWidgetBuildPathIsSharedSafe,
  fnWidgetBuildSourceHasForbiddenImportSyntax,
  fnWidgetBuildSourceHasRuntimeReExport,
} from './fn.build-boundary';
import {
  fnAttachServerFunctionModulePaths,
  fnGenerateServerFunctionEntrySource,
} from './fn.server-function-modules';
import type { TServerFunctionModule } from './fn.server-function-modules';
import { fnWidgetSourcePathIsSafe } from './fn.source-snapshot';
import { PinnedLocalDirectory } from './PinnedLocalDirectory';
import type { TPinnedLocalDirectory } from './PinnedLocalDirectory';
import { WidgetSourceSnapshot } from './WidgetSourceSnapshot';

export type TWidgetArtifactBuilderBunConfig = Readonly<{
  tempRoot: string;
  builderIdentity: string;
  snapshotService?: WidgetSourceSnapshot;
  build?: typeof Bun.build;
  /** Exact trusted packages bundled into each target; guest code cannot add entries. */
  allowedUiPackageImports?: readonly string[];
  allowedServerPackageImports?: readonly string[];
  /** Host-owned entrypoint resolver; returned files are bundled, never emitted as imports. */
  resolveTrustedPackageImport?: (specifier: string) => string;
  functionDescriptorExtractor?: IWidgetServerFunctionDescriptorExtractor;
}>;

type TEncodedBuildOutput = Readonly<{
  path: string;
  loader: string;
  kind: string;
  digestSha256: string;
  bytesBase64: string;
}>;

const GENERATED_SERVER_ENTRY = '__vibecanvas_server_entry__.ts';
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const JAVASCRIPT_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serverFunctionModules(
  snapshot: TWidgetSourceSnapshot,
  serverGraph: ReadonlySet<string>,
  serverEntry: string,
): readonly TServerFunctionModule[] {
  const files = new Map(snapshot.files.map((file) => [file.path, file]));
  const transpiler = new Bun.Transpiler({ loader: 'tsx' });
  const claimedExports = new Set<string>();
  const modules: TServerFunctionModule[] = [];
  for (const path of [...serverGraph].sort(compareText)) {
    if (!JAVASCRIPT_SOURCE_PATTERN.test(path) || !fnWidgetBuildPathIsServerOnly(path, serverEntry)) {
      continue;
    }
    const file = files.get(path);
    if (!file) throw new Error('Server function module is absent from its pinned snapshot.');
    const exportNames = [...transpiler.scan(Buffer.from(file.bytes).toString('utf8')).exports]
      .sort(compareText);
    for (const exportName of exportNames) {
      if (!EXPORT_NAME_PATTERN.test(exportName) || claimedExports.has(exportName)) {
        throw new Error('Server function exports must be unique direct named exports.');
      }
      claimedExports.add(exportName);
    }
    if (exportNames.length > 0) modules.push(Object.freeze({ path, exportNames }));
  }
  return Object.freeze(modules);
}

function assertNoServerFunctionReExports(
  snapshot: TWidgetSourceSnapshot,
  serverGraph: ReadonlySet<string>,
  serverEntry: string,
): void {
  const files = new Map(snapshot.files.map((file) => [file.path, file]));
  for (const path of serverGraph) {
    if (!JAVASCRIPT_SOURCE_PATTERN.test(path) || !fnWidgetBuildPathIsServerOnly(path, serverEntry)) {
      continue;
    }
    const file = files.get(path);
    if (
      file
      && fnWidgetBuildSourceHasRuntimeReExport(Buffer.from(file.bytes).toString('utf8'))
    ) throw new Error('Server functions must not be re-exported.');
  }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function entryHostPath(root: string, entry: string): string {
  if (!fnWidgetSourcePathIsSafe(entry)) {
    throw new Error(`Widget build entry '${entry}' is not a safe relative source path.`);
  }
  return join(root, ...entry.split('/'));
}

function assertSnapshotContains(snapshot: TWidgetSourceSnapshot, entry: string): void {
  if (!snapshot.files.some((file) => file.path === entry)) {
    throw new Error(`Widget build entry '${entry}' is missing from the pinned source snapshot.`);
  }
}

function widgetBuildFailed(kind: TWidgetBuildArtifactKind | 'source'): Error {
  return Object.assign(new Error(`Widget ${kind} build failed.`), {
    code: 'WIDGET_BUILD_FAILED',
  });
}

function sourceRelativePath(sourceRoot: string, hostPath: string): string | null {
  const value = relative(resolve(sourceRoot), resolve(hostPath));
  if (
    value.length === 0
    || value === '..'
    || value.startsWith(`..${sep}`)
    || isAbsolute(value)
  ) return null;
  return value.split(sep).join('/');
}

function pinnedSnapshotImportsPlugin(config: Readonly<{
  sourceRoot: string;
  sourcePaths: readonly string[];
  allowedPackageImports: readonly string[];
  kind: TWidgetBuildArtifactKind;
  serverEntry: string | null;
  functionModules: readonly TServerFunctionModule[];
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  resolveTrustedPackageImport: (specifier: string) => string;
}>): Bun.BunPlugin {
  const CLIENT_NAMESPACE = 'vibecanvas-generated-function-client';
  return {
    name: 'vibecanvas-pinned-widget-imports',
    setup(builder) {
      builder.onResolve({
        filter: /^@vibecanvas\/sdk\/function-client$/,
      }, () => {
        if (config.kind !== 'ui') throw new Error('Widget SDK imports are UI-only.');
        return { path: config.resolveTrustedPackageImport('@vibecanvas/sdk/function-client') };
      });
      builder.onResolve({ filter: /.*/ }, (resolveArgs) => {
        if (resolveArgs.importer.length === 0) return undefined;
        const importerPath = sourceRelativePath(config.sourceRoot, resolveArgs.importer);
        if (importerPath === null) return undefined;
        const resolution = fnResolveWidgetBuildImport({
          importerPath,
          specifier: resolveArgs.path,
          sourcePaths: config.sourcePaths,
          allowedPackageImports: config.allowedPackageImports,
        });
        if (resolution.kind === 'package') {
          if (!fnWidgetBuildPackageImportAllowedForTarget({
            kind: config.kind,
            specifier: resolution.specifier,
            allowedPackageImports: config.allowedPackageImports,
          })) throw new Error('Widget build package is forbidden for this target.');
          return { path: config.resolveTrustedPackageImport(resolution.specifier) };
        }
        if (
          config.kind === 'ui'
          && fnWidgetBuildPathIsServerOnly(resolution.path, config.serverEntry)
        ) {
          const module = config.functionModules.find((candidate) => candidate.path === resolution.path);
          const descriptors = config.functionDescriptors.filter(
            (descriptor) => descriptor.modulePath === resolution.path,
          );
          if (!module || descriptors.length === 0) {
            throw new Error('UI artifact imported a module with no deployable server functions.');
          }
          return {
            path: JSON.stringify({ path: resolution.path, specifier: resolveArgs.path }),
            namespace: CLIENT_NAMESPACE,
          };
        }
        return { path: join(config.sourceRoot, ...resolution.path.split('/')) };
      });
      builder.onLoad({ filter: /.*/, namespace: CLIENT_NAMESPACE }, (loadArgs) => {
        const value = JSON.parse(loadArgs.path) as { path: string; specifier: string };
        const descriptors = config.functionDescriptors.filter(
          (descriptor) => descriptor.modulePath === value.path,
        );
        if (descriptors.length === 0) throw new Error('Generated function client module is empty.');
        return {
          contents: fnGenerateWidgetServerFunctionClientModule({
            descriptors,
            serverModuleSpecifier: value.specifier,
            includeTypeBindings: false,
          }),
          loader: 'ts',
        };
      });
    },
  };
}

function assertNoBuildTimeImportExecution(snapshot: TWidgetSourceSnapshot): void {
  for (const file of snapshot.files) {
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file.path)) continue;
    const sourceText = Buffer.from(file.bytes).toString('utf8');
    let normalizedSource: string;
    try {
      normalizedSource = new Bun.Transpiler({ loader: 'tsx' }).transformSync(sourceText);
    } catch {
      throw widgetBuildFailed('source');
    }
    if (
      fnWidgetBuildSourceHasForbiddenImportSyntax(sourceText)
      || fnWidgetBuildSourceHasForbiddenImportSyntax(normalizedSource)
    ) {
      throw widgetBuildFailed('source');
    }
  }
}

function pinnedBuildImportGraph(args: Readonly<{
  snapshot: TWidgetSourceSnapshot;
  entry: string;
  kind: TWidgetBuildArtifactKind;
  serverEntry: string | null;
  functionModules: readonly TServerFunctionModule[];
  allowedPackageImports: readonly string[];
}>): ReadonlySet<string> {
  const sourceFiles = new Map(args.snapshot.files.map((file) => [file.path, file]));
  const sourcePaths = [...sourceFiles.keys()];
  const transpiler = new Bun.Transpiler({ loader: 'tsx' });
  const pending = [args.entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const importerPath = pending.pop()!;
    if (visited.has(importerPath)) continue;
    visited.add(importerPath);
    if (!/\.(?:[cm]?[jt]sx?)$/.test(importerPath)) continue;
    const source = sourceFiles.get(importerPath);
    if (!source) throw new Error('Widget build import is absent from its pinned source snapshot.');
    const imports = transpiler.scanImports(Buffer.from(source.bytes).toString('utf8'));
    for (const importRecord of imports) {
      const resolution = fnResolveWidgetBuildImport({
        importerPath,
        specifier: importRecord.path,
        sourcePaths,
        allowedPackageImports: args.allowedPackageImports,
      });
      if (resolution.kind === 'package') {
        if (!fnWidgetBuildPackageImportAllowedForTarget({
          kind: args.kind,
          specifier: resolution.specifier,
          allowedPackageImports: args.allowedPackageImports,
        })) throw new Error('Widget build package is forbidden for this target.');
        continue;
      }
      if (
        args.kind === 'ui'
        && fnWidgetBuildPathIsServerOnly(resolution.path, args.serverEntry)
      ) {
        if (!args.functionModules.some((module) => module.path === resolution.path)) {
          throw new Error('UI artifact imported a module with no deployable server functions.');
        }
        continue;
      }
      pending.push(resolution.path);
    }
  }
  return visited;
}

function assertDisjointWidgetBuildGraphs(
  uiGraph: ReadonlySet<string>,
  serverGraph: ReadonlySet<string>,
): void {
  for (const path of uiGraph) {
    if (serverGraph.has(path) && !fnWidgetBuildPathIsSharedSafe(path)) {
      throw new Error('UI and server artifacts cannot share transitive source modules.');
    }
  }
}

function assertEmittedBuildOutput(args: Readonly<{
  bytes: Uint8Array;
  loader: string;
}>): void {
  if (!['js', 'jsx', 'ts', 'tsx'].includes(args.loader)) return;
  const sourceText = Buffer.from(args.bytes).toString('utf8');
  if (fnWidgetBuildSourceHasForbiddenImportSyntax(sourceText)) {
    throw new Error('Widget build emitted a forbidden module loader.');
  }
  const imports = new Bun.Transpiler({ loader: 'js' }).scanImports(sourceText);
  if (imports.length > 0) throw new Error('Widget build output must be self-contained.');
}

function artifactOutputLoader(loader: string): string {
  return ['js', 'jsx', 'ts', 'tsx'].includes(loader) ? 'js' : loader;
}

function encodeArtifactEnvelope(args: Readonly<{
  kind: TWidgetBuildArtifactKind;
  entry: string;
  sourceDigestSha256: string;
  builderIdentity: string;
  runtimeAbi: string | null;
  outputs: readonly TEncodedBuildOutput[];
}>): Uint8Array {
  return Buffer.from(JSON.stringify({
    format: 'vibecanvas.widget-artifact.v1',
    kind: args.kind,
    entry: args.entry,
    sourceDigestSha256: args.sourceDigestSha256,
    builderIdentity: args.builderIdentity,
    runtimeAbi: args.runtimeAbi,
    outputs: args.outputs,
  }), 'utf8');
}

/** Fixed-policy trusted Bun builder for one pinned source snapshot. */
export class WidgetArtifactBuilderBun implements IWidgetArtifactBuilder {
  readonly #snapshotService: WidgetSourceSnapshot;
  readonly #build: typeof Bun.build;
  readonly #allowedPackageImports: Readonly<Record<TWidgetBuildArtifactKind, readonly string[]>>;
  readonly #resolveTrustedPackageImport: (specifier: string) => string;
  readonly #tempRoots: PinnedLocalDirectory;

  constructor(readonly config: TWidgetArtifactBuilderBunConfig) {
    this.#snapshotService = config.snapshotService ?? new WidgetSourceSnapshot();
    this.#build = config.build ?? Bun.build;
    this.#tempRoots = new PinnedLocalDirectory(config.tempRoot);
    this.#allowedPackageImports = Object.freeze({
      ui: Object.freeze([...fnNormalizeWidgetBuildAllowedPackageImports(
        config.allowedUiPackageImports ?? WIDGET_BUILD_DEFAULT_ALLOWED_UI_PACKAGE_IMPORTS,
      )]),
      server: Object.freeze([...fnNormalizeWidgetBuildAllowedPackageImports(
        config.allowedServerPackageImports ?? WIDGET_BUILD_DEFAULT_ALLOWED_SERVER_PACKAGE_IMPORTS,
      )]),
    });
    this.#resolveTrustedPackageImport = config.resolveTrustedPackageImport
      ?? ((specifier) => Bun.resolveSync(specifier, import.meta.dir));
  }

  async build(
    tenant: TTenantContext,
    request: TWidgetBuildRequest,
  ): Promise<TWidgetBuildResult> {
    if (request.builderIdentity !== this.config.builderIdentity) {
      throw new Error('Widget build requested an untrusted builder identity.');
    }
    const manifest = ZWidgetManifestV2.parse(request.manifest);
    if (request.canonicalManifestJson !== fnCanonicalizeWidgetManifest(manifest)) {
      throw new Error('Widget build canonical manifest does not match the validated manifest.');
    }
    assertSnapshotContains(request.snapshot, manifest.ui.entry);
    if (manifest.server !== undefined) {
      assertSnapshotContains(request.snapshot, manifest.server.entry);
    }

    const tempRoot = await this.#tempRoots.ensureRoot();
    const buildRoot = await mkdtemp(join(tempRoot.path, 'widget-build-'));
    const buildRootIdentity = await this.#pinBuildRoot(tempRoot, buildRoot);
    const sourceRoot = join(buildRoot, 'source');
    try {
      await this.#snapshotService.materialize(request.snapshot, sourceRoot);
      await this.#assertPinnedBuildRoot(tempRoot, buildRoot, buildRootIdentity);
      assertNoBuildTimeImportExecution(request.snapshot);
      const sourcePaths = request.snapshot.files.map((file) => file.path);
      if (sourcePaths.includes(GENERATED_SERVER_ENTRY)) throw widgetBuildFailed('source');
      let serverGraph: ReadonlySet<string> | null = null;
      let functionModules: readonly TServerFunctionModule[] = [];
      if (manifest.server !== undefined) {
        try {
          serverGraph = pinnedBuildImportGraph({
            snapshot: request.snapshot,
            entry: manifest.server.entry,
            kind: 'server',
            serverEntry: null,
            functionModules: [],
            allowedPackageImports: this.#allowedPackageImports.server,
          });
          functionModules = serverFunctionModules(
            request.snapshot,
            serverGraph,
            manifest.server.entry,
          );
        } catch {
          throw widgetBuildFailed('server');
        }
      }
      let uiGraph: ReadonlySet<string>;
      try {
        uiGraph = pinnedBuildImportGraph({
          snapshot: request.snapshot,
          entry: manifest.ui.entry,
          kind: 'ui',
          serverEntry: manifest.server?.entry ?? null,
          functionModules,
          allowedPackageImports: this.#allowedPackageImports.ui,
        });
      } catch {
        throw widgetBuildFailed('ui');
      }
      if (manifest.server !== undefined && serverGraph !== null) {
        try {
          assertDisjointWidgetBuildGraphs(uiGraph, serverGraph);
        } catch {
          throw widgetBuildFailed('ui');
        }
        try {
          assertNoServerFunctionReExports(
            request.snapshot,
            serverGraph,
            manifest.server.entry,
          );
        } catch {
          throw widgetBuildFailed('server');
        }
      }
      const serverArtifact = manifest.server === undefined
        ? null
        : await this.#buildTarget({
            kind: 'server',
            snapshot: request.snapshot,
            sourceRoot,
            sourcePaths,
            entry: manifest.server.entry,
            sourceDigestSha256: request.snapshot.digestSha256,
            builderIdentity: request.builderIdentity,
            runtimeAbi: manifest.server.runtimeAbi,
            serverEntry: null,
            functionModules,
            functionDescriptors: [],
            tempRoot,
            buildRoot,
            buildRootIdentity,
          });
      let functionDescriptors;
      try {
        const extracted = serverArtifact === null
          ? []
          : await this.#extractFunctionDescriptors(tenant, {
                serverArtifact,
                serverEntry: manifest.server!.entry,
                runtimeAbi: manifest.server!.runtimeAbi,
              });
        functionDescriptors = ZWidgetServerFunctionDescriptors.parse(
          fnAttachServerFunctionModulePaths(extracted, functionModules),
        );
      } catch {
        throw widgetBuildFailed('server');
      }
      const functionValidation = fnValidateWidgetServerFunctionDescriptors(
        manifest,
        functionDescriptors,
      );
      if (!functionValidation.valid) throw widgetBuildFailed('server');
      const uiArtifact = await this.#buildTarget({
        kind: 'ui',
        snapshot: request.snapshot,
        sourceRoot,
        sourcePaths,
        entry: manifest.ui.entry,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        runtimeAbi: null,
        serverEntry: manifest.server?.entry ?? null,
        functionModules,
        functionDescriptors,
        tempRoot,
        buildRoot,
        buildRootIdentity,
      });
      const functionDescriptorsDigestSha256 = sha256(
        fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
      );
      const contractDigestSha256 = sha256(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson: request.canonicalManifestJson,
        uiDigestSha256: uiArtifact.digestSha256,
        serverDigestSha256: serverArtifact?.digestSha256 ?? null,
        runtimeAbi: manifest.server?.runtimeAbi ?? null,
        functionDescriptorsDigestSha256,
      }));
      return Object.freeze({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        canonicalManifestJson: request.canonicalManifestJson,
        functionDescriptors,
        functionDescriptorsDigestSha256,
        contractDigestSha256,
        uiArtifact,
        serverArtifact,
      });
    } finally {
      await this.#removePinnedBuildRoot(tempRoot, buildRoot, buildRootIdentity);
    }
  }

  async #extractFunctionDescriptors(
    tenant: TTenantContext,
    request: Parameters<IWidgetServerFunctionDescriptorExtractor['extractServerFunctionDescriptors']>[1],
  ) {
    const extractor = this.config.functionDescriptorExtractor;
    if (extractor === undefined) {
      throw Object.assign(new Error('Server builds require a registration-sandbox descriptor extractor.'), {
        code: 'WIDGET_FUNCTION_DESCRIPTOR_EXTRACTOR_REQUIRED',
      });
    }
    try {
      return await extractor.extractServerFunctionDescriptors(tenant, request);
    } catch {
      throw widgetBuildFailed('server');
    }
  }

  async #pinBuildRoot(
    tempRoot: TPinnedLocalDirectory,
    buildRoot: string,
  ): Promise<Readonly<{ device: number; inode: number }>> {
    await this.#tempRoots.assertDirectory(tempRoot);
    const value = await lstat(buildRoot);
    if (!value.isDirectory() || value.isSymbolicLink()) {
      throw new Error('Widget build root must be a real directory.');
    }
    return Object.freeze({ device: Number(value.dev), inode: Number(value.ino) });
  }

  async #removePinnedBuildRoot(
    tempRoot: TPinnedLocalDirectory,
    buildRoot: string,
    identity: Readonly<{ device: number; inode: number }>,
  ): Promise<void> {
    await this.#tempRoots.assertDirectory(tempRoot);
    let value;
    try {
      value = await lstat(buildRoot);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (
      !value.isDirectory()
      || value.isSymbolicLink()
      || Number(value.dev) !== identity.device
      || Number(value.ino) !== identity.inode
    ) {
      throw new Error('Widget build root identity changed before cleanup.');
    }
    await rm(buildRoot, { recursive: true, force: false });
    await this.#tempRoots.assertDirectory(tempRoot);
  }

  async #assertPinnedBuildRoot(
    tempRoot: TPinnedLocalDirectory,
    buildRoot: string,
    identity: Readonly<{ device: number; inode: number }>,
  ): Promise<void> {
    await this.#tempRoots.assertDirectory(tempRoot);
    const value = await lstat(buildRoot);
    if (
      !value.isDirectory()
      || value.isSymbolicLink()
      || Number(value.dev) !== identity.device
      || Number(value.ino) !== identity.inode
    ) {
      throw new Error('Widget build root identity changed.');
    }
  }

  async #buildTarget(args: Readonly<{
    kind: TWidgetBuildArtifactKind;
    snapshot: TWidgetSourceSnapshot;
    sourceRoot: string;
    sourcePaths: readonly string[];
    entry: string;
    sourceDigestSha256: string;
    builderIdentity: string;
    runtimeAbi: string | null;
    serverEntry: string | null;
    functionModules: readonly TServerFunctionModule[];
    functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
    tempRoot: TPinnedLocalDirectory;
    buildRoot: string;
    buildRootIdentity: Readonly<{ device: number; inode: number }>;
  }>): Promise<TWidgetBuildArtifact> {
    let result: Bun.BuildOutput;
    try {
      pinnedBuildImportGraph({
        snapshot: args.snapshot,
        entry: args.entry,
        kind: args.kind,
        serverEntry: args.serverEntry,
        functionModules: args.functionModules,
        allowedPackageImports: this.#allowedPackageImports[args.kind],
      });
      await this.#assertPinnedBuildRoot(
        args.tempRoot,
        args.buildRoot,
        args.buildRootIdentity,
      );
      const entrypoint = args.kind === 'server'
        ? join(args.sourceRoot, GENERATED_SERVER_ENTRY)
        : entryHostPath(args.sourceRoot, args.entry);
      if (args.kind === 'server') {
        await writeFile(
          entrypoint,
          fnGenerateServerFunctionEntrySource(args.entry, args.functionModules),
          { flag: 'wx', mode: 0o600 },
        );
      }
      result = await this.#build({
        entrypoints: [entrypoint],
        root: args.sourceRoot,
        target: args.kind === 'ui' ? 'browser' : 'bun',
        format: 'esm',
        splitting: false,
        sourcemap: 'none',
        minify: true,
        packages: 'bundle',
        allowUnresolved: [],
        env: 'disable',
        plugins: [pinnedSnapshotImportsPlugin({
          sourceRoot: args.sourceRoot,
          sourcePaths: args.sourcePaths,
          allowedPackageImports: this.#allowedPackageImports[args.kind],
          kind: args.kind,
          serverEntry: args.serverEntry,
          functionModules: args.functionModules,
          functionDescriptors: args.functionDescriptors,
          resolveTrustedPackageImport: this.#resolveTrustedPackageImport,
        })],
      });
      await this.#assertPinnedBuildRoot(
        args.tempRoot,
        args.buildRoot,
        args.buildRootIdentity,
      );
    } catch {
      throw widgetBuildFailed(args.kind);
    }
    if (!result.success) throw widgetBuildFailed(args.kind);
    const ordered = [...result.outputs].sort((left, right) => {
      const leftKey = `${left.kind}:${left.loader}:${basename(left.path)}`;
      const rightKey = `${right.kind}:${right.loader}:${basename(right.path)}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    if (ordered.length === 0) throw widgetBuildFailed(args.kind);
    const outputs: TEncodedBuildOutput[] = [];
    for (const [index, output] of ordered.entries()) {
      const bytes = new Uint8Array(await output.arrayBuffer());
      try {
        assertEmittedBuildOutput({
          bytes,
          loader: output.loader,
        });
      } catch {
        throw widgetBuildFailed(args.kind);
      }
      const loader = artifactOutputLoader(output.loader);
      outputs.push(Object.freeze({
        path: `output-${index}.${loader === 'file' ? 'bin' : loader}`,
        loader,
        kind: output.kind,
        digestSha256: sha256(bytes),
        bytesBase64: Buffer.from(bytes).toString('base64'),
      }));
    }
    const bytes = encodeArtifactEnvelope({
      kind: args.kind,
      entry: args.entry,
      sourceDigestSha256: args.sourceDigestSha256,
      builderIdentity: args.builderIdentity,
      runtimeAbi: args.runtimeAbi,
      outputs,
    });
    return Object.freeze({
      kind: args.kind,
      digestSha256: sha256(bytes),
      bytes,
    });
  }
}

import { createHash } from 'node:crypto';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV2,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
} from '..';
import type {
  IWidgetArtifactBuilder,
  TWidgetBuildArtifact,
  TWidgetBuildArtifactKind,
  TWidgetBuildRequest,
  TWidgetBuildResult,
  TWidgetSourceSnapshot,
} from '..';
import { WIDGET_BUILD_DEFAULT_ALLOWED_PACKAGE_IMPORTS } from './CONSTANTS';
import {
  fnNormalizeWidgetBuildAllowedPackageImports,
  fnResolveWidgetBuildImport,
  fnWidgetBuildPathIsServerOnly,
  fnWidgetBuildPathIsSharedSafe,
  fnWidgetBuildSourceHasForbiddenImportSyntax,
} from './fn.build-boundary';
import { fnWidgetSourcePathIsSafe } from './fn.source-snapshot';
import { PinnedLocalDirectory } from './PinnedLocalDirectory';
import type { TPinnedLocalDirectory } from './PinnedLocalDirectory';
import { WidgetSourceSnapshot } from './WidgetSourceSnapshot';

export type TWidgetArtifactBuilderBunConfig = Readonly<{
  tempRoot: string;
  builderIdentity: string;
  snapshotService?: WidgetSourceSnapshot;
  build?: typeof Bun.build;
  /** Exact runtime package imports left external to the immutable artifact. */
  allowedPackageImports?: readonly string[];
}>;

type TEncodedBuildOutput = Readonly<{
  path: string;
  loader: string;
  kind: string;
  digestSha256: string;
  bytesBase64: string;
}>;

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
}>): Bun.BunPlugin {
  return {
    name: 'vibecanvas-pinned-widget-imports',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (resolveArgs) => {
        if (resolveArgs.importer.length === 0) return undefined;
        const importerPath = sourceRelativePath(config.sourceRoot, resolveArgs.importer);
        if (importerPath === null) {
          throw new Error('Widget build importer is outside its pinned source snapshot.');
        }
        const resolution = fnResolveWidgetBuildImport({
          importerPath,
          specifier: resolveArgs.path,
          sourcePaths: config.sourcePaths,
          allowedPackageImports: config.allowedPackageImports,
        });
        if (resolution.kind === 'package') {
          return { path: resolution.specifier, external: true };
        }
        if (
          config.kind === 'ui'
          && fnWidgetBuildPathIsServerOnly(resolution.path, config.serverEntry)
        ) {
          throw new Error('UI artifacts cannot import server modules.');
        }
        return { path: join(config.sourceRoot, ...resolution.path.split('/')) };
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
      if (resolution.kind === 'package') continue;
      if (
        args.kind === 'ui'
        && fnWidgetBuildPathIsServerOnly(resolution.path, args.serverEntry)
      ) {
        throw new Error('UI artifacts cannot import server modules.');
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
  allowedPackageImports: readonly string[];
}>): void {
  if (!['js', 'jsx', 'ts', 'tsx'].includes(args.loader)) return;
  const sourceText = Buffer.from(args.bytes).toString('utf8');
  if (fnWidgetBuildSourceHasForbiddenImportSyntax(sourceText)) {
    throw new Error('Widget build emitted a forbidden module loader.');
  }
  const imports = new Bun.Transpiler({ loader: 'js' }).scanImports(sourceText);
  for (const record of imports) {
    if (!args.allowedPackageImports.includes(record.path)) {
      throw new Error('Widget build emitted an import outside the fixed package allowlist.');
    }
  }
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
  readonly #allowedPackageImports: readonly string[];
  readonly #tempRoots: PinnedLocalDirectory;

  constructor(readonly config: TWidgetArtifactBuilderBunConfig) {
    this.#snapshotService = config.snapshotService ?? new WidgetSourceSnapshot();
    this.#build = config.build ?? Bun.build;
    this.#tempRoots = new PinnedLocalDirectory(config.tempRoot);
    this.#allowedPackageImports = Object.freeze([
      ...fnNormalizeWidgetBuildAllowedPackageImports(
        config.allowedPackageImports ?? WIDGET_BUILD_DEFAULT_ALLOWED_PACKAGE_IMPORTS,
      ),
    ]);
  }

  async build(
    _tenant: TTenantContext,
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
      let uiGraph: ReadonlySet<string>;
      try {
        uiGraph = pinnedBuildImportGraph({
          snapshot: request.snapshot,
          entry: manifest.ui.entry,
          kind: 'ui',
          serverEntry: manifest.server?.entry ?? null,
          allowedPackageImports: this.#allowedPackageImports,
        });
      } catch {
        throw widgetBuildFailed('ui');
      }
      if (manifest.server !== undefined) {
        let serverGraph: ReadonlySet<string>;
        try {
          serverGraph = pinnedBuildImportGraph({
            snapshot: request.snapshot,
            entry: manifest.server.entry,
            kind: 'server',
            serverEntry: null,
            allowedPackageImports: this.#allowedPackageImports,
          });
        } catch {
          throw widgetBuildFailed('server');
        }
        try {
          assertDisjointWidgetBuildGraphs(uiGraph, serverGraph);
        } catch {
          throw widgetBuildFailed('ui');
        }
      }
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
        tempRoot,
        buildRoot,
        buildRootIdentity,
      });
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
            tempRoot,
            buildRoot,
            buildRootIdentity,
          });
      const contractDigestSha256 = sha256(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson: request.canonicalManifestJson,
        uiDigestSha256: uiArtifact.digestSha256,
        serverDigestSha256: serverArtifact?.digestSha256 ?? null,
        runtimeAbi: manifest.server?.runtimeAbi ?? null,
      }));
      return Object.freeze({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        canonicalManifestJson: request.canonicalManifestJson,
        contractDigestSha256,
        uiArtifact,
        serverArtifact,
      });
    } finally {
      await this.#removePinnedBuildRoot(tempRoot, buildRoot, buildRootIdentity);
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
        allowedPackageImports: this.#allowedPackageImports,
      });
      await this.#assertPinnedBuildRoot(
        args.tempRoot,
        args.buildRoot,
        args.buildRootIdentity,
      );
      result = await this.#build({
        entrypoints: [entryHostPath(args.sourceRoot, args.entry)],
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
          allowedPackageImports: this.#allowedPackageImports,
          kind: args.kind,
          serverEntry: args.serverEntry,
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
          allowedPackageImports: this.#allowedPackageImports,
        });
      } catch {
        throw widgetBuildFailed(args.kind);
      }
      outputs.push(Object.freeze({
        path: `output-${index}.${output.loader === 'file' ? 'bin' : output.loader}`,
        loader: output.loader,
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

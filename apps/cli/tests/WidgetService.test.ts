import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BunChildFunctionDescriptorExtractor } from '@vibecanvas/function-runtime/local';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import { fnFreezeTenantContext, type TTenantContext } from '@vibecanvas/tenant-core';
import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import type { TWidgetManifestV2, TWidgetRevisionDescriptor } from '@vibecanvas/widget-contract';
import { WidgetSourceSnapshot } from '@vibecanvas/widget-contract/local';
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';
import { WidgetService } from '../src/services/WidgetService';
import { WidgetServicePool } from '../src/services/WidgetServicePool';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const TENANT = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: uuid(801),
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'widget-service-test',
});

const FOREIGN_TENANT = fnFreezeTenantContext({
  ...TENANT,
  orgId: uuid(802),
  requestId: 'widget-service-foreign',
});

const OTHER_ACCOUNT_TENANT = fnFreezeTenantContext({
  ...TENANT,
  accountId: uuid(899),
  requestId: 'widget-service-other-account',
});

const BUILDER_IDENTITY = 'vibecanvas-widget-test/bun';
const TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS = Object.freeze([
  '@arrow-js/core',
  '@vibecanvas/sdk/server',
  '@vibecanvas/sdk/function-client',
  '@vibecanvas/sdk/widget',
  'zod',
]);

function resolveTrustedWidgetBuildPackageImport(specifier: string): string {
  if (!TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS.includes(specifier)) {
    throw new Error(`Untrusted widget build package '${specifier}'.`);
  }
  if (specifier === 'zod') {
    return join(dirname(Bun.resolveSync('zod/package.json', import.meta.dir)), 'index.cjs');
  }
  return Bun.resolveSync(specifier, import.meta.dir);
}

async function writeSource(
  sourceRoot: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(sourceRoot, ...relativePath.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

function outputText(bytes: Uint8Array): string {
  const envelope = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
    outputs: readonly Readonly<{ bytesBase64: string }>[];
  };
  return envelope.outputs
    .map((output) => Buffer.from(output.bytesBase64, 'base64').toString('utf8'))
    .join('\n');
}

async function filesBelow(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const relativePath = relativeDirectory.length === 0
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  };
  await visit(root, '');
  return files.sort();
}

async function tableCount(database: DbServiceTurso, table: 'artifact_references'
  | 'legacy_actor_definitions'
  | 'legacy_actor_instances'
  | 'widget_definition_revisions'
  | 'widget_definitions'
  | 'widget_revision_sources'): Promise<number> {
  const query = {
    artifact_references: 'SELECT count(*) AS count FROM artifact_references WHERE org_id = ?',
    legacy_actor_definitions: 'SELECT count(*) AS count FROM legacy_actor_definitions WHERE org_id = ?',
    legacy_actor_instances: 'SELECT count(*) AS count FROM legacy_actor_instances WHERE org_id = ?',
    widget_definition_revisions: 'SELECT count(*) AS count FROM widget_definition_revisions WHERE org_id = ?',
    widget_definitions: 'SELECT count(*) AS count FROM widget_definitions WHERE org_id = ?',
    widget_revision_sources: 'SELECT count(*) AS count FROM widget_revision_sources WHERE org_id = ?',
  }[table];
  const row = await (await database.db.prepare(query)).get(TENANT.orgId) as { count: unknown };
  return Number(row.count);
}

function readRequest(
  revision: TWidgetRevisionDescriptor,
  kind: 'ui' | 'server',
  capability: string,
) {
  const artifact = kind === 'ui' ? revision.uiArtifact : revision.serverArtifact;
  if (!artifact) throw new Error(`Expected ${kind} artifact.`);
  return {
    artifactId: artifact.id,
    readCapability: capability,
    purpose: kind === 'ui' ? 'browser_ui' as const : 'server_execution' as const,
  };
}

describe('actor-free production widget service', () => {
  let root: string;
  let artifactsRoot: string;
  let database: DbServiceTurso;
  let service: WidgetService;
  let functionDescriptorExtractor: BunChildFunctionDescriptorExtractor;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibecanvas-widget-service-'));
    artifactsRoot = join(root, 'organization', 'artifacts');
    await mkdir(artifactsRoot, { recursive: true });
    database = new DbServiceTurso({
      databasePath: join(root, 'main.db'),
      dataDir: root,
      cacheDir: join(root, 'cache'),
      silentMigrations: true,
    });
    await database.start();
    const functionTempRoot = join(root, 'temp', 'widget-functions');
    await mkdir(functionTempRoot, { recursive: true, mode: 0o700 });
    functionDescriptorExtractor = new BunChildFunctionDescriptorExtractor({
      tempRoot: functionTempRoot,
    });
    service = new WidgetService({
      placement: TENANT,
      database: database.db,
      artifactsRoot,
      buildTempRoot: join(root, 'temp', 'widget-builds'),
      builderIdentity: BUILDER_IDENTITY,
      artifactReadSecret: Buffer.alloc(32, 17),
      artifactReadMaximumTtlMs: 60_000,
      functionDescriptorExtractor,
      resolveTrustedPackageImport: resolveTrustedWidgetBuildPackageImport,
    });
  });

  afterEach(async () => {
    await database.stop();
    await rm(root, { recursive: true, force: true });
  });

  test('rejects invalid UI TypeScript during trusted validation without durable writes', async () => {
    const sourceRoot = join(root, 'invalid-ui-validation');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const broken: = 1;\n',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(840),
      createdAtMs: 10,
    });
    const result = await service.validateBuild(TENANT, {
      snapshot,
      manifest: {
        schemaVersion: 2,
        name: 'Invalid UI',
        slug: 'invalid-ui',
        ui: { entry: 'src/ui.ts' },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(['Widget source build failed.']);
    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('rejects semantic TypeScript errors during trusted validation without durable writes', async () => {
    const sourceRoot = join(root, 'semantic-error-validation');
    await writeSource(sourceRoot, {
      'ui/main.ts': 'const value: string = 42;\nexport default value;\n',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(843),
      createdAtMs: 10,
    });
    const result = await service.validateBuild(TENANT, {
      snapshot,
      manifest: {
        schemaVersion: 2,
        name: 'Semantic error',
        slug: 'semantic-error',
        ui: { entry: 'ui/main.ts' },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      "ui/main.ts:1:7 TS2322: Type 'number' is not assignable to type 'string'.",
    ]);
    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('rejects invalid server TypeScript during trusted validation without durable writes', async () => {
    const sourceRoot = join(root, 'invalid-server-validation');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const validUi = true;\n',
      'src/server.server.ts': 'export const broken: = 1;\n',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(841),
      createdAtMs: 10,
    });
    const result = await service.validateBuild(TENANT, {
      snapshot,
      manifest: {
        schemaVersion: 2,
        name: 'Invalid server',
        slug: 'invalid-server',
        ui: { entry: 'src/ui.ts' },
        server: { entry: 'src/server.server.ts', runtimeAbi: 'vibecanvas:test-1' },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(['Widget source build failed.']);
    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('validates the exact documented direct server entry without durable writes', async () => {
    const sourceRoot = join(root, 'documented-server-validation');
    await writeSource(sourceRoot, {
      'ui/main.ts': 'export default function mount() {}\n',
      'server/main.server.ts': [
        'import { defineServerFunction } from "@vibecanvas/sdk/server";',
        'import { z } from "zod";',
        '',
        'export const calculate = defineServerFunction({',
        '  effect: "fn",',
        '  input: z.object({ value: z.number().finite() }),',
        '  output: z.object({ doubled: z.number().finite() }),',
        '}, async (_context, input) => ({ doubled: input.value * 2 }));',
        '',
      ].join('\n'),
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(842),
      createdAtMs: 10,
    });
    const result = await service.validateBuild(TENANT, {
      snapshot,
      manifest: {
        schemaVersion: 2,
        name: 'Documented server widget',
        slug: 'documented-server-widget',
        ui: { entry: 'ui/main.ts' },
        server: {
          entry: 'server/main.server.ts',
          runtimeAbi: 'vibecanvas-function-v1',
        },
      },
    });

    expect(result).toEqual({ valid: true, diagnostics: [] });
    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('publishes and reads a browser-only definition without actor rows or actor files', async () => {
    const sourceRoot = join(root, 'source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const browserMarker = "BROWSER_ONLY_WIDGET";',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(803),
      createdAtMs: 10,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Browser widget',
      slug: 'browser-widget',
      ui: { entry: 'src/ui.ts' },
    };
    const published = await service.publish(TENANT, {
      definitionId: uuid(804),
      revisionId: uuid(805),
      expectedActiveRevisionId: null,
      snapshot,
      manifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      nowMs: 20,
    });
    expect(published.status).toBe('committed');
    if (published.status !== 'committed') throw new Error('Expected committed publication.');
    expect(published.revision).toMatchObject({
      revisionNumber: 1,
      serverArtifact: null,
      manifest: { schemaVersion: 2, slug: 'browser-widget' },
    });
    await expect(service.resolvePublishedPlacement(TENANT, {
      definitionId: published.definition.id,
      revisionId: published.revision.id,
    })).resolves.toMatchObject({
      definitionId: published.definition.id,
      revisionId: published.revision.id,
      slug: 'browser-widget',
      bounds: { width: 360, height: 320 },
    });
    await expect(service.listPublishedPlacements(TENANT)).resolves.toEqual([
      expect.objectContaining({
        definitionId: published.definition.id,
        revisionId: published.revision.id,
      }),
    ]);
    await expect(service.resolvePublishedPlacement(TENANT, {
      definitionId: uuid(898),
      revisionId: uuid(897),
    })).resolves.toBeNull();
    expect(await tableCount(database, 'widget_definitions')).toBe(1);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(1);
    expect(await tableCount(database, 'artifact_references')).toBe(2);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(1);
    expect(await tableCount(database, 'legacy_actor_definitions')).toBe(0);
    expect(await tableCount(database, 'legacy_actor_instances')).toBe(0);

    const artifactFiles = await filesBelow(artifactsRoot);
    expect(artifactFiles).toHaveLength(2);
    expect(artifactFiles.every((path) => (
      /^blobs\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(path)
    ))).toBe(true);
    expect(artifactFiles.some((path) => path.includes('widgets/') || path.includes('actors/'))).toBe(false);

    const expiresAtMs = Date.now() + 30_000;
    const source = await service.getRevisionSource(TENANT, published.revision.id);
    expect(source).toMatchObject({
      definitionId: published.definition.id,
      revisionId: published.revision.id,
      sourceSnapshotId: snapshot.id,
      sourceDigestSha256: snapshot.digestSha256,
      builderIdentity: BUILDER_IDENTITY,
      sourceArtifact: { kind: 'source' },
    });
    if (!source) throw new Error('Expected retained publication source.');
    const sourceCapability = await service.issueSourceBuildArtifactReadCapability(TENANT, {
      definitionId: published.definition.id,
      revisionId: published.revision.id,
      artifactId: source.sourceArtifact.id,
      artifactKind: 'source',
      digestSha256: source.sourceArtifact.digestSha256,
      expiresAtMs,
    });
    const sourceBytes = await service.readArtifact(TENANT, {
      artifactId: source.sourceArtifact.id,
      readCapability: sourceCapability,
      purpose: 'source_build',
    });
    expect(new WidgetSourceSnapshot().decodeArtifact({
      kind: 'source',
      digestSha256: source.sourceArtifact.digestSha256,
      bytes: sourceBytes!,
    }, {
      expectedSnapshotId: snapshot.id,
      expectedSourceDigestSha256: snapshot.digestSha256,
      expectedBuilderIdentity: BUILDER_IDENTITY,
    }).files).toEqual(snapshot.files);
    await expect(service.readRevisionSourceSnapshot(TENANT, {
      definitionId: published.definition.id,
      revisionId: published.revision.id,
    })).resolves.toMatchObject({
      id: snapshot.id,
      digestSha256: snapshot.digestSha256,
      files: snapshot.files,
    });
    await expect(service.readRevisionSourceSnapshot(TENANT, {
      definitionId: uuid(896),
      revisionId: published.revision.id,
    })).resolves.toBeNull();
    const artifact = published.revision.uiArtifact;
    const capability = await service.issueBrowserUiArtifactReadCapability(TENANT, {
      definitionId: published.definition.id,
      revisionId: published.revision.id,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      digestSha256: artifact.digestSha256,
      expiresAtMs,
    });
    const request = readRequest(published.revision, 'ui', capability);
    const bytes = await service.readArtifact(TENANT, request);
    expect(outputText(bytes!)).toContain('BROWSER_ONLY_WIDGET');
    await expect(service.readArtifact(TENANT, {
      ...request,
      readCapability: artifact.digestSha256,
    })).resolves.toBeNull();
    expect(() => service.readArtifact(FOREIGN_TENANT, request)).toThrow(
      'Widget service placement does not own this request.',
    );

    const artifactPath = join(
      artifactsRoot,
      'blobs',
      'sha256',
      artifact.digestSha256.slice(0, 2),
      artifact.digestSha256,
    );
    expect((await readFile(artifactPath)).byteLength).toBe(artifact.byteSize);
    await writeFile(artifactPath, 'tampered');
    await expect(service.readArtifact(TENANT, request)).rejects.toMatchObject({
      code: 'WIDGET_ARTIFACT_INTEGRITY_FAILED',
    });
    await expect(service.archive(TENANT, {
      definitionId: published.definition.id,
      expectedActiveRevisionId: published.revision.id,
      nowMs: 21,
    })).resolves.toMatchObject({
      status: 'archived',
      definition: { status: 'archived', activeRevisionId: null },
    });
    await expect(service.listPublishedPlacements(TENANT)).resolves.toEqual([]);
    await expect(service.resolvePublishedPlacement(TENANT, {
      definitionId: published.definition.id,
      revisionId: published.revision.id,
    })).resolves.toBeNull();
  });

  test('fails closed for capability issuance and reads after stored revision contract tampering', async () => {
    const sourceRoot = join(root, 'tampered-contract-source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const marker = "IMMUTABLE_CONTRACT";',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(816),
      createdAtMs: 10,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Tamper-resistant widget',
      slug: 'tamper-resistant-widget',
      ui: { entry: 'src/ui.ts' },
    };
    const published = await service.publish(TENANT, {
      definitionId: uuid(817),
      revisionId: uuid(818),
      expectedActiveRevisionId: null,
      snapshot,
      manifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      nowMs: 20,
    });
    if (published.status !== 'committed') throw new Error('Expected publication to commit.');

    const artifact = published.revision.uiArtifact;
    const capabilityRequest = {
      definitionId: published.definition.id,
      revisionId: published.revision.id,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      digestSha256: artifact.digestSha256,
      expiresAtMs: Date.now() + 30_000,
    };
    const capability = await service.issueBrowserUiArtifactReadCapability(TENANT, capabilityRequest);
    const request = readRequest(published.revision, 'ui', capability);
    expect(outputText((await service.readArtifact(TENANT, request))!)).toContain('IMMUTABLE_CONTRACT');

    await (await database.db.prepare(`
      UPDATE widget_definition_revisions
      SET contract_digest_sha256 = ?
      WHERE org_id = ? AND id = ?
    `)).run('f'.repeat(64), TENANT.orgId, published.revision.id);

    await expect(service.getRevision(TENANT, published.revision.id)).rejects.toMatchObject({
      code: 'WIDGET_REVISION_INTEGRITY_FAILED',
    });
    await expect(
      service.issueBrowserUiArtifactReadCapability(TENANT, capabilityRequest),
    ).rejects.toMatchObject({ code: 'WIDGET_REVISION_INTEGRITY_FAILED' });
    await expect(service.readArtifact(TENANT, request)).rejects.toMatchObject({
      code: 'WIDGET_REVISION_INTEGRITY_FAILED',
    });
  });

  test('builds account-isolated immutable UI and server preview revisions without actors', async () => {
    const nowMs = Date.now();
    await (await database.db.prepare(`
      INSERT INTO accounts (
        id, kind, display_name, status, is_autogenerated, created_at_ms, updated_at_ms
      ) VALUES (?, 'user', 'Other account', 'active', 0, ?, ?)
    `)).run(OTHER_ACCOUNT_TENANT.accountId, nowMs, nowMs);
    await (await database.db.prepare(`
      INSERT INTO organization_memberships (
        org_id, account_id, role, status, is_billable_seat, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'member', 'active', 1, ?, ?)
    `)).run(TENANT.orgId, OTHER_ACCOUNT_TENANT.accountId, nowMs, nowMs);

    const authoring = service.authoringStore;
    const chatId = uuid(820);
    const draftId = uuid(821);
    const definitionId = uuid(822);
    await authoring.createChat(TENANT, {
      id: chatId,
      canvasId: null,
      externalSessionKey: 'preview-integration-chat',
      name: 'Preview integration',
      workspaceRelativePath: 'agent/chats/preview-integration',
      historyRelativePath: 'agent/history/preview-integration.jsonl',
      nowMs,
    });
    await authoring.createDraft(TENANT, {
      id: draftId,
      chatId,
      definitionId,
      name: 'Preview widget',
      sourceRelativePath: 'agent/widgets/drafts/preview-widget',
      nowMs: nowMs + 1,
    });

    const sourceRoot = join(root, 'preview-source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const previewMarker = "UI_PREVIEW_MARKER";',
    });
    const uiSnapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(823),
      createdAtMs: nowMs + 2,
    });
    expect(await authoring.compareAndSetDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: uiSnapshot.digestSha256,
      nextStatus: 'ready',
      nowMs: nowMs + 3,
    })).toMatchObject({ status: 'updated' });
    const uiManifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Preview widget',
      slug: 'preview-widget',
      ui: { entry: 'src/ui.ts' },
    };
    const previewId = uuid(824);
    const uiRevisionId = uuid(825);
    const uiPreview = await service.buildPreview(TENANT, {
      previewId,
      expectedActiveRevisionId: null,
      revisionId: uiRevisionId,
      draftId,
      definitionId,
      draftRevisionSha256: uiSnapshot.digestSha256,
      snapshot: uiSnapshot,
      manifest: uiManifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      nowMs: nowMs + 4,
      expiresAtMs: nowMs + 60_000,
      retainUntilMs: nowMs + 120_000,
    });
    expect(uiPreview).toMatchObject({
      status: 'committed',
      revision: { id: uiRevisionId, serverArtifact: null },
    });
    await expect(service.getPreview(OTHER_ACCOUNT_TENANT, {
      previewId,
      nowMs: nowMs + 5,
    })).resolves.toBeNull();
    const activeUi = await service.getPreview(TENANT, { previewId, nowMs: nowMs + 5 });
    if (!activeUi) throw new Error('Expected active UI preview.');
    const uiCapability = await service.issueUiPreviewArtifactReadCapability(TENANT, {
      previewId,
      previewRevisionId: uiRevisionId,
      artifactId: activeUi.uiArtifact.id,
      artifactKind: 'ui',
      digestSha256: activeUi.uiArtifact.digestSha256,
      expiresAtMs: nowMs + 30_000,
    });
    expect(outputText((await service.readArtifact(TENANT, {
      artifactId: activeUi.uiArtifact.id,
      readCapability: uiCapability,
      purpose: 'preview_ui',
    }))!)).toContain('UI_PREVIEW_MARKER');

    await writeSource(sourceRoot, {
      'src/ui.ts': [
        'import { previewServer } from "./server.server";',
        'export const previewMarker = "SERVER_UI_PREVIEW_MARKER";',
        'export const invokePreviewServer = (value: string) => previewServer({ value });',
      ].join('\n'),
      'src/server.server.ts': [
        'import { defineServerFunction } from "@vibecanvas/sdk/server";',
        'import { z } from "zod";',
        'const Value = z.object({ value: z.string() });',
        'export const previewServer = defineServerFunction({',
        '  effect: "fn", input: Value, output: Value,',
        '}, async (_ctx, input) => ({ value: `SERVER_PREVIEW_MARKER:${input.value}` }));',
      ].join('\n'),
    });
    const serverSnapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(826),
      createdAtMs: nowMs + 6,
    });
    expect(await authoring.compareAndSetDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: uiSnapshot.digestSha256,
      nextSourceDigestSha256: serverSnapshot.digestSha256,
      nextStatus: 'ready',
      nowMs: nowMs + 7,
    })).toMatchObject({ status: 'updated' });
    const serverRevisionId = uuid(827);
    const serverPreview = await service.buildPreview(TENANT, {
      previewId,
      expectedActiveRevisionId: uiRevisionId,
      revisionId: serverRevisionId,
      draftId,
      definitionId,
      draftRevisionSha256: serverSnapshot.digestSha256,
      snapshot: serverSnapshot,
      manifest: {
        ...uiManifest,
        server: { entry: 'src/server.server.ts', runtimeAbi: 'vibecanvas:test-1' },
      },
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      nowMs: nowMs + 8,
      expiresAtMs: nowMs + 60_000,
      retainUntilMs: nowMs + 120_000,
    });
    expect(serverPreview).toMatchObject({
      status: 'committed',
      previousActiveRevisionId: uiRevisionId,
      revision: { id: serverRevisionId, serverArtifact: { kind: 'server' } },
    });
    if (serverPreview.status !== 'committed' || !serverPreview.revision.serverArtifact) {
      throw new Error('Expected committed server preview.');
    }
    const serverArtifact = serverPreview.revision.serverArtifact;
    const serverCapability = await service.issueServerPreviewArtifactReadCapability(TENANT, {
      previewId,
      previewRevisionId: serverRevisionId,
      artifactId: serverArtifact.id,
      artifactKind: 'server',
      digestSha256: serverArtifact.digestSha256,
      expiresAtMs: nowMs + 30_000,
    });
    expect(outputText((await service.readArtifact(TENANT, {
      artifactId: serverArtifact.id,
      readCapability: serverCapability,
      purpose: 'preview_server',
    }))!)).toContain('SERVER_PREVIEW_MARKER');
    expect(await service.stopPreview(TENANT, {
      previewId,
      expectedActiveRevisionId: serverRevisionId,
      nowMs: nowMs + 9,
    })).toBe(true);
    await expect(service.getPreview(TENANT, {
      previewId,
      nowMs: nowMs + 10,
    })).resolves.toBeNull();
    await expect(service.getPreviewRevision(TENANT, {
      previewId,
      revisionId: serverRevisionId,
      nowMs: nowMs + 10,
    })).resolves.toMatchObject({ id: serverRevisionId });
    expect(await tableCount(database, 'legacy_actor_definitions')).toBe(0);
    expect(await tableCount(database, 'legacy_actor_instances')).toBe(0);
  });

  test('publishes separate server/UI artifacts, rolls back by CAS, and collects the inactive revision', async () => {
    const sourceRoot = join(root, 'source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const uiMarker = "UI_REVISION_ONE";',
    });
    const firstSnapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(806),
      createdAtMs: 100,
    });
    const firstManifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Revision widget',
      slug: 'revision-widget',
      ui: { entry: 'src/ui.ts' },
    };
    const first = await service.publish(TENANT, {
      definitionId: uuid(807),
      revisionId: uuid(808),
      expectedActiveRevisionId: null,
      snapshot: firstSnapshot,
      manifest: firstManifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      nowMs: 100,
    });
    if (first.status !== 'committed') throw new Error('Expected first revision to commit.');

    await writeSource(sourceRoot, {
      'src/ui.ts': [
        'import { serverMarker } from "./server.server";',
        'export const uiMarker = "UI_REVISION_TWO";',
        'export const invokeServerMarker = (value: string) => serverMarker({ value });',
      ].join('\n'),
      'src/server.server.ts': [
        'import { defineServerFunction } from "@vibecanvas/sdk/server";',
        'import { z } from "zod";',
        'const Input = z.object({ value: z.string() });',
        'const Output = z.object({ value: z.string() });',
        'export const serverMarker = defineServerFunction({',
        '  effect: "fn", input: Input, output: Output,',
        '}, async (_ctx, input) => ({ value: `SERVER_PRIVATE_MARKER:${input.value}` }));',
      ].join('\n'),
    });
    const secondSnapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(809),
      createdAtMs: 200,
    });
    const secondManifest: TWidgetManifestV2 = {
      ...firstManifest,
      server: { entry: 'src/server.server.ts', runtimeAbi: 'vibecanvas:test-1' },
    };
    const second = await service.publish(TENANT, {
      definitionId: first.definition.id,
      revisionId: uuid(810),
      expectedActiveRevisionId: first.revision.id,
      snapshot: secondSnapshot,
      manifest: secondManifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      nowMs: 200,
    });
    if (second.status !== 'committed') throw new Error('Expected second revision to commit.');
    expect(second.revision.revisionNumber).toBe(2);
    expect(second.revision.serverArtifact).not.toBeNull();
    expect(second.revision.functionDescriptors).toMatchObject([{
      exportName: 'serverMarker',
      effect: 'fn',
      resources: [],
    }]);
    expect(second.revision.functionDescriptorsDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(functionDescriptorExtractor.diagnostics()).toEqual({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });

    const expiresAtMs = Date.now() + 30_000;
    const uiCapability = await service.issueBrowserUiArtifactReadCapability(TENANT, {
      definitionId: second.definition.id,
      revisionId: second.revision.id,
      artifactId: second.revision.uiArtifact.id,
      artifactKind: 'ui',
      digestSha256: second.revision.uiArtifact.digestSha256,
      expiresAtMs,
    });
    const serverArtifact = second.revision.serverArtifact!;
    const serverCapability = await service.issueServerExecutionArtifactReadCapability(TENANT, {
      definitionId: second.definition.id,
      revisionId: second.revision.id,
      artifactId: serverArtifact.id,
      artifactKind: 'server',
      digestSha256: serverArtifact.digestSha256,
      expiresAtMs,
    });
    const uiBytes = await service.readArtifact(TENANT, readRequest(second.revision, 'ui', uiCapability));
    const serverBytes = await service.readArtifact(
      TENANT,
      readRequest(second.revision, 'server', serverCapability),
    );
    expect(outputText(uiBytes!)).toContain('UI_REVISION_TWO');
    expect(outputText(uiBytes!)).not.toContain('SERVER_PRIVATE_MARKER');
    expect(outputText(serverBytes!)).toContain('SERVER_PRIVATE_MARKER');

    const rollback = await service.rollback(TENANT, {
      definitionId: first.definition.id,
      expectedActiveRevisionId: second.revision.id,
      targetRevisionId: first.revision.id,
      nowMs: 300,
    });
    expect(rollback).toMatchObject({ status: 'updated', activeRevisionId: first.revision.id });
    await expect(service.resolvePublishedPlacement(TENANT, {
      definitionId: first.definition.id,
      revisionId: first.revision.id,
    })).resolves.toMatchObject({
      definitionId: first.definition.id,
      revisionId: first.revision.id,
    });
    await expect(service.resolvePublishedPlacement(TENANT, {
      definitionId: second.definition.id,
      revisionId: second.revision.id,
    })).resolves.toBeNull();
    await expect(service.rollback(TENANT, {
      definitionId: first.definition.id,
      expectedActiveRevisionId: second.revision.id,
      targetRevisionId: first.revision.id,
      nowMs: 301,
    })).resolves.toEqual({ status: 'conflict', currentActiveRevisionId: first.revision.id });

    const collected = await service.collect(TENANT, {
      nowMs: 400,
      gracePeriodMs: 0,
      limit: 100,
    });
    expect(collected.deleted).toBe(3);
    expect(await service.getRevision(TENANT, second.revision.id)).toBeNull();
    expect(await service.getActiveRevision(TENANT, first.definition.id)).toMatchObject({
      id: first.revision.id,
    });
    expect(await tableCount(database, 'artifact_references')).toBe(2);
    expect(await filesBelow(artifactsRoot)).toHaveLength(2);
  });

  test('persists no definition, revision, binding, or blob when the optional server build fails', async () => {
    const sourceRoot = join(root, 'source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const validUi = true;',
      'src/server.server.ts': 'export const = ;',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(811),
      createdAtMs: 10,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Broken server widget',
      slug: 'broken-server-widget',
      ui: { entry: 'src/ui.ts' },
      server: { entry: 'src/server.server.ts', runtimeAbi: 'vibecanvas:test-1' },
    };
    await expect(service.publish(TENANT, {
      definitionId: uuid(812),
      revisionId: uuid(813),
      expectedActiveRevisionId: null,
      snapshot,
      manifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      nowMs: 20,
    })).rejects.toMatchObject({ code: 'WIDGET_BUILD_FAILED' });

    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('production composition keeps v2 publication and placement actor-free by default', async () => {
    const compositionRoot = join(root, 'production-composition');
    await mkdir(compositionRoot, { recursive: true });
    const home = fnResolveVibecanvasHome({ join, resolve }, {
      cwd: compositionRoot,
      dataDir: compositionRoot,
      env: {},
      homedir: compositionRoot,
    });
    const config: ICliConfig = {
      cwd: compositionRoot,
      dev: true,
      compiled: false,
      legacyActorEnabled: false,
      version: '0.0.0-test',
      command: 'serve',
      rawArgv: ['bun', 'run'],
      argv: [],
      port: 0,
      home,
      helpRequested: false,
      versionRequested: false,
    };
    const { services } = setupServices(config);
    const widgetOwner = services.require('widgetOwner');
    const widgetCapability = services.require('widget');
    const actorOwner = services.get('actor');
    const agentOwner = services.require('agent');
    const resourceOwner = services.require('resourceOwner');
    const compositionDatabase = services.require('db');
    const registrations = new Map(
      services.getRegistrations().map((registration) => [registration.name, registration.startOrder]),
    );
    expect(registrations.get('widgetOwner')).toBe(55);
    expect(registrations.get('widget')).toBe(56);
    expect(actorOwner).toBeUndefined();
    expect(registrations.has('actor')).toBe(false);
    expect(Reflect.ownKeys(widgetCapability).sort()).toEqual([
      'getActiveRevision',
      'getArtifact',
      'getRevision',
      'getRevisionSource',
      'issueBrowserUiArtifactReadCapability',
      'listPublishedPlacements',
      'publish',
      'readArtifact',
      'resolvePublishedPlacement',
      'rollback',
    ]);
    expect('buildPreview' in widgetCapability).toBe(false);
    expect('issueServerExecutionArtifactReadCapability' in widgetCapability).toBe(false);

    await compositionDatabase.start();
    widgetOwner.start({ config: {}, hooks: {} });
    resourceOwner.start({ config: {}, hooks: {} });
    agentOwner.start({ config: {}, hooks: {} });
    try {
      const first = await widgetOwner.forTenant(TENANT);
      const second = await widgetOwner.forTenant(fnFreezeTenantContext({
        ...TENANT,
        accountId: uuid(899),
        requestId: 'widget-service-second-account',
      }));
      expect(second).toBe(first);
      expect(widgetOwner.getTenantCount()).toBe(1);

      const sourceRoot = join(compositionRoot, 'placement-source');
      await writeSource(sourceRoot, {
        'src/ui.ts': 'export const placementMarker = "PLACEMENT_WIDGET";',
      });
      const snapshot = await first.captureSource(TENANT, sourceRoot, {
        id: uuid(890),
        createdAtMs: 10,
      });
      const published = await first.publish(TENANT, {
        definitionId: uuid(891),
        revisionId: uuid(892),
        expectedActiveRevisionId: null,
        snapshot,
        manifest: {
          schemaVersion: 2,
          name: 'Placement widget',
          slug: 'placement-widget',
          ui: { entry: 'src/ui.ts' },
        },
        bindings: [],
        builderIdentity: `vibecanvas-widget-bun/${Bun.version}`,
        nowMs: 20,
      });
      if (published.status !== 'committed') throw new Error('Expected committed publication.');
      expect(published.revision.serverArtifact).toBeNull();

      const agent = await agentOwner.forTenant(TENANT);
      const catalogEntry = (await agent.getWidgetCatalog([])).widgets.find(
        (entry) => entry.name === 'Placement widget',
      );
      const reference = catalogEntry?.published?.placement?.reference;
      if (!reference) throw new Error('Expected published placement reference.');
      expect(reference).toEqual({
        source: 'published',
        name: `v2:${published.definition.id}`,
        revision: published.revision.id,
      });
      await expect(agent.resolveWidgetPlacement(reference)).resolves.toMatchObject({
        ok: true,
        descriptor: {
          kind: 'published-v2',
          reference,
          bounds: { width: 360, height: 320 },
          definitionId: published.definition.id,
          revisionId: published.revision.id,
          definitionName: null,
          definitionSlug: 'placement-widget',
          previewId: null,
        },
      });
      expect(await tableCount(compositionDatabase, 'legacy_actor_definitions')).toBe(0);
      expect(await tableCount(compositionDatabase, 'legacy_actor_instances')).toBe(0);
    } finally {
      await agentOwner.stop();
      await resourceOwner.stop();
      await widgetOwner.stop();
      await compositionDatabase.stop();
    }
  });
});

describe('WidgetServicePool placement fencing', () => {
  const placementTarget = {
    definitionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    revisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
  } as const;
  const movedTenant = (placementEpoch: number): TTenantContext => fnFreezeTenantContext({
    ...TENANT,
    cellId: uuid(900 + placementEpoch),
    placementEpoch,
    requestId: `widget-pool-placement-${placementEpoch}`,
  });

  test('retires a higher-epoch owner and rejects stale placement resolution', async () => {
    const events: string[] = [];
    const pool = new WidgetServicePool({
      create: async (placement) => ({
        start: async () => { events.push(`start:${placement.placementEpoch}`); },
        stop: async () => { events.push(`stop:${placement.placementEpoch}`); },
        resolvePublishedPlacement: async (_tenant: TTenantContext, target: typeof placementTarget) => {
          events.push(`resolve:${placement.placementEpoch}:${target.revisionId}`);
          return {
            ...target,
            name: 'Weather',
            slug: 'weather',
            description: null,
            contractDigestSha256: 'c'.repeat(64),
            updatedAtMs: 1,
            bounds: { width: 360, height: 320 },
          };
        },
      } as unknown as WidgetService),
    });
    pool.start({ hooks: {}, config: {} });

    await expect(pool.resolvePublishedPlacement(movedTenant(1), placementTarget)).resolves.toMatchObject({
      definitionId: placementTarget.definitionId,
      revisionId: placementTarget.revisionId,
    });
    await expect(pool.resolvePublishedPlacement(movedTenant(2), placementTarget)).resolves.toMatchObject({
      definitionId: placementTarget.definitionId,
      revisionId: placementTarget.revisionId,
    });
    expect(events).toEqual([
      'start:1',
      `resolve:1:${placementTarget.revisionId}`,
      'stop:1',
      'start:2',
      `resolve:2:${placementTarget.revisionId}`,
    ]);
    expect(pool.getTenantCount()).toBe(1);
    await expect(pool.resolvePublishedPlacement(movedTenant(1), placementTarget)).rejects.toThrow(
      'rejected stale organization placement epoch 1; current epoch is 2',
    );
    await pool.stop();
  });

  test('drains an in-flight placement resolver before higher-epoch startup', async () => {
    const events: string[] = [];
    let markOldResolverEntered: (() => void) | undefined;
    const oldResolverEntered = new Promise<void>((resolve) => {
      markOldResolverEntered = resolve;
    });
    let releaseOldResolver: (() => void) | undefined;
    const oldResolverBlocked = new Promise<void>((resolve) => {
      releaseOldResolver = resolve;
    });
    const pool = new WidgetServicePool({
      create: async (placement) => ({
        start: async () => { events.push(`start:${placement.placementEpoch}`); },
        stop: async () => { events.push(`stop:${placement.placementEpoch}`); },
        resolvePublishedPlacement: async (_tenant: TTenantContext, target: typeof placementTarget) => {
          events.push(`resolve:start:${placement.placementEpoch}:${target.revisionId}`);
          if (placement.placementEpoch === 1) {
            markOldResolverEntered?.();
            await oldResolverBlocked;
          }
          events.push(`resolve:end:${placement.placementEpoch}:${target.revisionId}`);
          return null;
        },
      } as unknown as WidgetService),
    });
    pool.start({ hooks: {}, config: {} });

    const oldResolution = pool.resolvePublishedPlacement(movedTenant(1), placementTarget);
    await oldResolverEntered;
    const replacementResolution = pool.resolvePublishedPlacement(movedTenant(2), placementTarget);
    await Promise.resolve();
    expect(events).toEqual([
      'start:1',
      `resolve:start:1:${placementTarget.revisionId}`,
    ]);

    releaseOldResolver?.();
    await expect(oldResolution).resolves.toBeNull();
    await expect(replacementResolution).resolves.toBeNull();
    expect(events).toEqual([
      'start:1',
      `resolve:start:1:${placementTarget.revisionId}`,
      `resolve:end:1:${placementTarget.revisionId}`,
      'stop:1',
      'start:2',
      `resolve:start:2:${placementTarget.revisionId}`,
      `resolve:end:2:${placementTarget.revisionId}`,
    ]);
    await pool.stop();
  });
});

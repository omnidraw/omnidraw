import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  buildCapsuleGuest,
} from '@vibecanvas/capsule-vibecanvas/build';
import { BunChildFunctionDescriptorExtractor } from '@vibecanvas/function-runtime/local';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import { fnFreezeTenantContext, type TTenantContext } from '@vibecanvas/tenant-core';
import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetConstructionContractPayload,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnWidgetPreviewBindingPlanDigest,
  type TWidgetArtifactDescriptor,
  type TWidgetDistributionBuildProvenance,
  type TWidgetManifestV3,
  type TWidgetRevisionDescriptor,
} from '@vibecanvas/widget-contract';
import {
  LocalWidgetArtifactStore,
  WidgetSourceSnapshot,
} from '@vibecanvas/widget-contract/local';
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';
import { WidgetService } from '../src/services/WidgetService';
import {
  createWidgetAuthoringCapability,
  WidgetServicePool,
} from '../src/services/WidgetServicePool';
import { WidgetCapsuleSigningKeyStore } from '../src/services/WidgetCapsuleSigningKeyStore';
import { fnWidgetCapsuleBuilderIdentity } from '../src/services/fn.widget-capsule-builder-identity';
import {
  CAPSULE_PUBLICATION_IDENTITY,
  capsuleRuntimeDescriptor,
  capsuleUi,
  testWidgetDistributionBuild,
} from './widget-capsule.fixture';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

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
  '@vibecanvas/sdk/server',
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

function serverOutputText(bytes: Uint8Array): string {
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

async function insertPreviewFrame(
  database: DbServiceTurso,
  args: Readonly<{
    canvasId: string;
    frameNodeId: string;
    previewId: string;
    draftId: string;
    originChatId: string;
    role: 'companion' | 'placed';
  }>,
): Promise<void> {
  await (await database.db.prepare(`
    INSERT INTO canvas_items (
      org_id, canvas_id, id, item_json, item_revision,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 0, 3, 3)
  `)).run(
    TENANT.orgId,
    args.canvasId,
    args.frameNodeId,
    JSON.stringify({
      id: args.frameNodeId,
      kind: 'widget-frame',
      parentId: null,
      orderKey: 'preview-frame',
      extensions: {
        'vibecanvas:widget': {
          schemaVersion: 1,
          type: 'ui-widget',
          kind: 'preview',
          payload: {
            previewId: args.previewId,
            draftId: args.draftId,
            originChatId: args.originChatId,
            role: args.role,
          },
        },
      },
    }),
  );
}

async function insertAiChatFrame(
  database: DbServiceTurso,
  args: Readonly<{
    canvasId: string;
    frameNodeId: string;
    sessionId: string;
  }>,
): Promise<void> {
  await (await database.db.prepare(`
    INSERT INTO canvas_items (
      org_id, canvas_id, id, item_json, item_revision,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 0, 3, 3)
  `)).run(
    TENANT.orgId,
    args.canvasId,
    args.frameNodeId,
    JSON.stringify({
      id: args.frameNodeId,
      kind: 'widget-frame',
      parentId: null,
      orderKey: 'ai-chat-frame',
      extensions: {
        'vibecanvas:widget': {
          schemaVersion: 1,
          type: 'ui-widget',
          kind: 'ai',
          payload: {
            sessionId: args.sessionId,
          },
        },
      },
    }),
  );
}

async function tableCount(database: DbServiceTurso, table: 'artifact_references'
  | 'widget_definition_revisions'
  | 'widget_definitions'
  | 'widget_revision_sources'): Promise<number> {
  const query = {
    artifact_references: 'SELECT count(*) AS count FROM artifact_references WHERE org_id = ?',
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

describe('production widget service', () => {
  let root: string;
  let artifactsRoot: string;
  let database: DbServiceTurso;
  let service: WidgetService;
  let functionDescriptorExtractor: BunChildFunctionDescriptorExtractor;
  let capsuleBuildCount: number;
  let distributionBuildCount: number;

  beforeEach(async () => {
    capsuleBuildCount = 0;
    distributionBuildCount = 0;
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
      buildEnvironmentIdentity: 'widget-service-test-environment/v1',
      ...CAPSULE_PUBLICATION_IDENTITY,
      capsuleBuild: async (request) => {
        capsuleBuildCount += 1;
        return buildCapsuleGuest(request);
      },
      distributionBuild: async (request) => {
        distributionBuildCount += 1;
        return testWidgetDistributionBuild(request);
      },
      loadCapsuleSigningKeys: (purpose) => (
        new WidgetCapsuleSigningKeyStore(join(root, 'keys')).loadSigningKeys(purpose)
      ),
      artifactReadSecret: Buffer.alloc(32, 17),
      artifactReadMaximumTtlMs: 60_000,
      artifactGcIntervalMs: 5,
      artifactGcGracePeriodMs: 7,
      artifactGcLimit: 9,
      functionDescriptorExtractor,
      resolveTrustedPackageImport: resolveTrustedWidgetBuildPackageImport,
    });
  });

  afterEach(async () => {
    await database.stop();
    await rm(root, { recursive: true, force: true });
  });

  test('runs artifact reconciliation at startup and periodically until stopped', async () => {
    const calls: Array<Readonly<{
      tenant: TTenantContext;
      request: Readonly<{ nowMs: number; gracePeriodMs: number; limit: number }>;
    }>> = [];
    let resolveSecondCall: (() => void) | null = null;
    const secondCall = new Promise<void>((resolve) => {
      resolveSecondCall = resolve;
    });
    service.collect = async (tenant, request) => {
      calls.push({ tenant, request });
      if (calls.length === 2) resolveSecondCall?.();
      return {
        reconciledPinned: 0,
        reconciledEligible: 0,
        deleted: 0,
        restored: 0,
      };
    };

    await service.start();
    await Promise.race([
      secondCall,
      Bun.sleep(500).then(() => {
        throw new Error('Timed out waiting for scheduled artifact reconciliation.');
      }),
    ]);
    await service.stop();
    const countAfterStop = calls.length;
    await Bun.sleep(20);

    expect(calls.length).toBe(countAfterStop);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((call) => (
      call.tenant.orgId === TENANT.orgId
      && call.tenant.accountId === TENANT.accountId
      && call.tenant.cellId === TENANT.cellId
      && call.tenant.placementEpoch === TENANT.placementEpoch
      && call.request.gracePeriodMs === 7
      && call.request.limit === 9
      && Number.isSafeInteger(call.request.nowMs)
    ))).toBe(true);
  });

  test('rejects invalid UI TypeScript through the Capsule build port without durable writes', async () => {
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
        schemaVersion: 3,
        name: 'Invalid UI',
        slug: 'invalid-ui',
        ui: capsuleUi('src/ui.ts'),
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      'Widget ui build failed: TRANSFORM_FAILED at src/ui.ts.',
    ]);
    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('lets the guest build script decide whether semantic TypeScript checks are required', async () => {
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
        schemaVersion: 3,
        name: 'Semantic error',
        slug: 'semantic-error',
        ui: capsuleUi('ui/main.ts'),
      },
    });

    expect(result).toEqual({ valid: true, diagnostics: [] });
    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('reuses one exact build and invalidates source-lock and manifest inputs', async () => {
    const sourceRoot = join(root, 'build-key-invalidation');
    await writeSource(sourceRoot, {
      'package-lock.json': '{"lockfileVersion":3,"packages":{"":{"version":"1.0.0"}}}',
      'ui/main.ts': 'document.body.textContent = "build-key";\n',
    });
    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Build key widget',
      slug: 'build-key-widget',
      ui: capsuleUi('ui/main.ts'),
    };
    const firstSnapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(8_430),
      createdAtMs: 10,
    });

    await expect(service.validateBuild(TENANT, {
      snapshot: firstSnapshot,
      manifest,
    })).resolves.toEqual({ valid: true, diagnostics: [] });
    await expect(service.validateBuild(TENANT, {
      snapshot: firstSnapshot,
      manifest,
    })).resolves.toEqual({ valid: true, diagnostics: [] });
    expect(distributionBuildCount).toBe(1);
    expect(capsuleBuildCount).toBe(1);

    await writeSource(sourceRoot, {
      'package-lock.json': '{"lockfileVersion":3,"packages":{"":{"version":"1.0.1"}}}',
    });
    const secondSnapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(8_431),
      createdAtMs: 11,
    });
    expect(secondSnapshot.digestSha256).not.toBe(firstSnapshot.digestSha256);
    await expect(service.validateBuild(TENANT, {
      snapshot: secondSnapshot,
      manifest,
    })).resolves.toEqual({ valid: true, diagnostics: [] });
    expect(distributionBuildCount).toBe(2);
    expect(capsuleBuildCount).toBe(2);

    await expect(service.validateBuild(TENANT, {
      snapshot: secondSnapshot,
      manifest: { ...manifest, description: 'Changed canonical manifest.' },
    })).resolves.toEqual({ valid: true, diagnostics: [] });
    expect(distributionBuildCount).toBe(3);
    expect(capsuleBuildCount).toBe(3);
  });

  test('rejects invalid server TypeScript through the separate server build without durable writes', async () => {
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
        schemaVersion: 3,
        name: 'Invalid server',
        slug: 'invalid-server',
        ui: capsuleUi('src/ui.ts'),
        server: { entry: 'src/server.server.ts', runtimeAbi: 'vibecanvas:test-1' },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(['Widget server build failed.']);
    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'widget_revision_sources')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('validates the exact documented direct server entry without durable writes', async () => {
    const sourceRoot = join(root, 'documented-server-validation');
    await writeSource(sourceRoot, {
      'ui/main.ts': 'document.body.append(document.createElement("main"));\n',
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
        schemaVersion: 3,
        name: 'Documented server widget',
        slug: 'documented-server-widget',
        ui: capsuleUi('ui/main.ts'),
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

  test('publishes and reads a browser-only definition from revision artifacts', async () => {
    const sourceRoot = join(root, 'source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const browserMarker = "BROWSER_ONLY_WIDGET";',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(803),
      createdAtMs: 10,
    });
    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Browser widget',
      slug: 'browser-widget',
      ui: capsuleUi('src/ui.ts'),
    };
    const published = await service.publish(TENANT, {
      definitionId: uuid(804),
      revisionId: uuid(805),
      expectedActiveRevisionId: null,
      snapshot,
      manifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      ...CAPSULE_PUBLICATION_IDENTITY,
      nowMs: 20,
    });
    expect(published.status).toBe('committed');
    if (published.status !== 'committed') throw new Error('Expected committed publication.');
    expect(published.revision).toMatchObject({
      revisionNumber: 1,
      serverArtifact: null,
      manifest: { schemaVersion: 3, slug: 'browser-widget' },
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

    const artifactFiles = await filesBelow(artifactsRoot);
    expect(artifactFiles).toHaveLength(2);
    expect(artifactFiles.every((path) => (
      /^blobs\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(path)
    ))).toBe(true);
    expect(artifactFiles.some((path) => path.includes('widgets/'))).toBe(false);

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
    expect(bytes).toHaveLength(artifact.byteSize);
    expect(Buffer.from(bytes!).subarray(0, 1).toString('utf8')).not.toBe('{');
    expect(published.revision.uiRuntime).toMatchObject({
      format: 'vibecanvas.capsule-runtime.v1',
      capsuleArtifactHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      signatureKeyIds: ['vibecanvas-release-v1'],
    });
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

  test('promotes the exact durable Preview construction without another guest build', async () => {
    const canvasId = uuid(814);
    const chatId = uuid(815);
    const draftId = uuid(816);
    const definitionId = uuid(817);
    const previewId = uuid(818);
    const previewRevisionId = uuid(819);
    const publishedRevisionId = uuid(834);
    const previewTenant = fnFreezeTenantContext({ ...TENANT, canvasId });
    await database.forTenant(TENANT).canvas.create({
      id: canvasId,
      name: 'Exact promotion canvas',
    });
    await service.authoringStore.createChat(previewTenant, {
      id: chatId,
      canvasId,
      externalSessionKey: 'exact-promotion-chat',
      name: 'Exact promotion chat',
      workspaceRelativePath: 'chats/exact-promotion',
      historyRelativePath: 'history/exact-promotion.jsonl',
      nowMs: 1,
    });
    await service.authoringStore.createDraft(previewTenant, {
      id: draftId,
      chatId,
      definitionId,
      name: 'Exact promotion draft',
      sourceRelativePath: 'drafts/exact-promotion',
      nowMs: 2,
    });
    await (await database.db.prepare(`
      INSERT INTO widget_definitions (
        org_id, id, slug, name, status, active_revision_id,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'exact-promotion', 'Exact promotion', 'draft', NULL, 2, 2)
    `)).run(TENANT.orgId, definitionId);
    await insertAiChatFrame(database, {
      canvasId,
      frameNodeId: 'exact-promotion-ai-chat-frame',
      sessionId: 'exact-promotion-chat',
    });
    await service.authoringStore.ensurePreviewOwner(previewTenant, {
      id: previewId,
      canvasId,
      frameNodeId: 'exact-promotion-frame',
      draftId,
      originChatId: chatId,
      role: 'companion',
      nowMs: 3,
    });
    const previewFrame = {
      canvasId,
      frameNodeId: 'exact-promotion-frame',
      previewId,
      draftId,
      originChatId: chatId,
      role: 'companion' as const,
    };
    await insertPreviewFrame(database, previewFrame);

    const sourceRoot = join(root, 'preview-source');
    await writeSource(sourceRoot, {
      'src/ui.ts': [
        'const root = document.createElement("main");',
        'root.textContent = "SIGNED_PREVIEW";',
        'document.body.append(root);',
      ].join('\n'),
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
    const snapshot = await service.captureSource(previewTenant, sourceRoot, {
      id: uuid(835),
      createdAtMs: 4,
    });
    const committedMutationId = 'mutation-exact-promotion-1';
    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Exact promotion',
      slug: 'exact-promotion',
      ui: capsuleUi('src/ui.ts'),
      server: {
        entry: 'server/main.server.ts',
        runtimeAbi: 'vibecanvas-function-v1',
      },
    };
    await expect(service.authoringStore.compareAndSetDraft(previewTenant, {
      draftId,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: snapshot.digestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      nextStatus: 'ready',
      nowMs: 4,
      lastError: null,
    })).resolves.toMatchObject({
      status: 'updated',
      draft: { sourceDigestSha256: snapshot.digestSha256 },
    });
    await expect(service.authoringStore.compareAndSetPreviewOwner(previewTenant, {
      previewId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      status: 'building',
      activeRevisionId: null,
      pendingBuildId: previewRevisionId,
      lastError: null,
      expectedBindingRevision: 0,
      nextBindingRevision: 0,
      expectedBindingPlanDigestSha256: null,
      nextBindingPlanDigestSha256: sha256('[]'),
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: snapshot.digestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      nowMs: 5,
    })).resolves.toMatchObject({
      status: 'building',
      buildSequence: 1,
    });

    const validation = await service.validateBuild(previewTenant, {
      snapshot,
      manifest,
    });
    expect(validation).toEqual({ valid: true, diagnostics: [] });

    const previewBuild = {
      previewId,
      previewRevisionId,
      expectedActiveRevisionId: null,
      buildSequence: 1,
      bindingRevision: 0,
      draftId,
      definitionId,
      draftRevisionSha256: snapshot.digestSha256,
      committedMutationId,
      snapshot,
      manifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      ...CAPSULE_PUBLICATION_IDENTITY,
      nowMs: 6,
    } as const;
    await (await database.db.prepare(`
      DELETE FROM canvas_items
      WHERE org_id = ? AND canvas_id = ? AND id = ?
    `)).run(TENANT.orgId, canvasId, previewFrame.frameNodeId);
    await expect(service.buildPreview(previewTenant, previewBuild))
      .rejects.toMatchObject({ code: 'WIDGET_PREVIEW_FRAME_STALE' });
    await insertPreviewFrame(database, previewFrame);
    const preview = await service.buildPreview(previewTenant, previewBuild);

    expect(preview.uiArtifact.runtimeDescriptor.signatureKeyIds).toEqual([
      'vibecanvas-preview-v1',
    ]);
    expect(preview.functionDescriptors).toHaveLength(1);
    expect(capsuleBuildCount).toBe(1);
    expect(distributionBuildCount).toBe(1);
    const reviewed = await service.authoringStore.getPreviewRevision(previewTenant, {
      previewId,
      revisionId: previewRevisionId,
    });
    if (!reviewed) throw new Error('Expected durable reviewed Preview revision.');
    expect(reviewed.uiRuntime.capsuleArtifactHash).toBe(
      preview.uiArtifact.capsuleArtifactHash,
    );
    expect(reviewed.functionDescriptors).toEqual(preview.functionDescriptors);

    const promotion = {
      idempotencyKey: 'publish-exact-promotion-preview',
      previewId,
      previewRevisionId,
      canvasId,
      frameNodeId: 'exact-promotion-frame',
      expectedDraftRevisionSha256: snapshot.digestSha256,
      expectedBindingRevision: 0,
      expectedBindingPlanDigestSha256:
        preview.bindingPlanDigestSha256!,
      definitionId,
      expectedActiveRevisionId: null,
      revisionId: publishedRevisionId,
      nowMs: 7,
    } as const;
    await expect(service.publishPreview(previewTenant, {
      ...promotion,
      expectedDraftRevisionSha256: 'f'.repeat(64),
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    await expect(service.publishPreview(previewTenant, {
      ...promotion,
      canvasId: 'wrong-canvas',
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    await expect(service.publishPreview(previewTenant, {
      ...promotion,
      frameNodeId: 'wrong-frame',
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    await (await database.db.prepare(`
      DELETE FROM canvas_items
      WHERE org_id = ? AND canvas_id = ? AND id = ?
    `)).run(TENANT.orgId, canvasId, previewFrame.frameNodeId);
    await expect(service.publishPreview(previewTenant, promotion))
      .rejects.toMatchObject({ code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    await insertPreviewFrame(database, {
      ...previewFrame,
      previewId: uuid(8_399),
    });
    await expect(service.publishPreview(previewTenant, promotion))
      .rejects.toMatchObject({ code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    await (await database.db.prepare(`
      DELETE FROM canvas_items
      WHERE org_id = ? AND canvas_id = ? AND id = ?
    `)).run(TENANT.orgId, canvasId, previewFrame.frameNodeId);
    await insertPreviewFrame(database, previewFrame);
    expect(capsuleBuildCount).toBe(1);
    expect(distributionBuildCount).toBe(1);

    const published = await service.publishPreview(previewTenant, promotion);
    if (published.status !== 'committed') throw new Error('Expected publication to commit.');
    expect(await service.authoringStore.getPreviewOwner(
      previewTenant,
      previewId,
    )).toMatchObject({
      publishedPreviewRevisionId: previewRevisionId,
      publishedBindingRevision: promotion.expectedBindingRevision,
      publishedBindingPlanDigestSha256:
        promotion.expectedBindingPlanDigestSha256,
      publishedWidgetRevisionId: publishedRevisionId,
      publishedIdempotencyKey: promotion.idempotencyKey,
    });
    expect(capsuleBuildCount).toBe(1);
    expect(distributionBuildCount).toBe(1);
    expect(published.revision.uiRuntime.capsuleArtifactHash).toBe(
      reviewed.uiRuntime.capsuleArtifactHash,
    );
    expect(published.revision.uiRuntime.signatureKeyIds).toEqual([
      'vibecanvas-release-v1',
    ]);
    expect(reviewed.uiRuntime.signatureKeyIds).toEqual([
      'vibecanvas-preview-v1',
    ]);
    expect(published.revision.uiArtifact.digestSha256).not.toBe(
      reviewed.uiArtifact.digestSha256,
    );
    expect(published.revision.contractDigestSha256).not.toBe(
      reviewed.previewContractDigestSha256,
    );
    expect(published.revision.constructionContractDigestSha256).toBe(
      reviewed.constructionContractDigestSha256,
    );
    expect(published.revision.distributionProvenance).toEqual(
      reviewed.distributionProvenance,
    );
    expect(published.revision.functionDescriptors).toEqual(
      reviewed.functionDescriptors,
    );
    expect(published.revision.functionDescriptorsDigestSha256).toBe(
      reviewed.functionDescriptorsDigestSha256,
    );
    expect(published.revision.serverArtifact?.digestSha256).toBe(
      reviewed.serverArtifact?.digestSha256,
    );
    expect(published.revision.serverArtifact?.byteSize).toBe(
      reviewed.serverArtifact?.byteSize,
    );
    const publishedSource = await service.getRevisionSource(
      previewTenant,
      publishedRevisionId,
    );
    expect(publishedSource).toMatchObject({
      sourceSnapshotId: reviewed.sourceSnapshotId,
      sourceDigestSha256: reviewed.sourceDigestSha256,
      sourceArtifact: {
        digestSha256: reviewed.sourceArtifact.digestSha256,
        byteSize: reviewed.sourceArtifact.byteSize,
      },
      builderIdentity: reviewed.builderIdentity,
    });

    await expect(service.publishPreview(previewTenant, {
      ...promotion,
      idempotencyKey: 'publish-same-selection-again',
      expectedActiveRevisionId: publishedRevisionId,
      revisionId: uuid(8_389),
      nowMs: 8,
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_ALREADY_PUBLISHED' });
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(1);

    const replay = await service.publishPreview(previewTenant, {
      ...promotion,
      expectedActiveRevisionId: publishedRevisionId,
      revisionId: uuid(8_390),
      nowMs: 8,
    });
    expect(replay).toMatchObject({
      status: 'committed',
      revision: { id: publishedRevisionId },
      previousActiveRevisionId: null,
    });
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(1);

    const noOpCommittedMutationId = 'mutation-exact-promotion-no-op';
    await expect(service.authoringStore.compareAndSetDraft(previewTenant, {
      draftId,
      expectedSourceDigestSha256: snapshot.digestSha256,
      nextSourceDigestSha256: snapshot.digestSha256,
      expectedCommittedMutationId: committedMutationId,
      nextCommittedMutationId: noOpCommittedMutationId,
      expectedBuildSequence: 1,
      nextBuildSequence: 2,
      nextStatus: 'ready',
      nowMs: 9,
      lastError: null,
    })).resolves.toMatchObject({ status: 'updated' });
    await expect(service.publishPreview(previewTenant, {
      ...promotion,
      expectedActiveRevisionId: publishedRevisionId,
      revisionId: uuid(8_393),
      nowMs: 9,
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_PROMOTION_STALE' });

    const changedSourceRoot = join(root, 'preview-source-conflict');
    await writeSource(changedSourceRoot, {
      'src/ui.ts': [
        'const root = document.createElement("main");',
        'root.textContent = "CONFLICTING_PREVIEW";',
        'document.body.append(root);',
      ].join('\n'),
      'server/main.server.ts': [
        'import { defineServerFunction } from "@vibecanvas/sdk/server";',
        'import { z } from "zod";',
        'export const calculate = defineServerFunction({',
        '  effect: "fn",',
        '  input: z.object({ value: z.number().finite() }),',
        '  output: z.object({ doubled: z.number().finite() }),',
        '}, async (_context, input) => ({ doubled: input.value * 2 }));',
      ].join('\n'),
    });
    const changedSnapshot = await service.captureSource(
      previewTenant,
      changedSourceRoot,
      { id: uuid(8_391), createdAtMs: 9 },
    );
    const changedCommittedMutationId = 'mutation-exact-promotion-2';
    await expect(service.authoringStore.compareAndSetDraft(previewTenant, {
      draftId,
      expectedSourceDigestSha256: snapshot.digestSha256,
      nextSourceDigestSha256: changedSnapshot.digestSha256,
      expectedCommittedMutationId: noOpCommittedMutationId,
      nextCommittedMutationId: changedCommittedMutationId,
      expectedBuildSequence: 2,
      nextBuildSequence: 3,
      nextStatus: 'ready',
      nowMs: 9,
      lastError: null,
    })).resolves.toMatchObject({ status: 'updated' });
    const artifactCountBeforeConflict = await tableCount(
      database,
      'artifact_references',
    );
    await expect(service.buildPreview(previewTenant, {
      ...previewBuild,
      previewRevisionId: uuid(8_392),
      expectedActiveRevisionId: previewRevisionId,
      buildSequence: 3,
      draftRevisionSha256: changedSnapshot.digestSha256,
      committedMutationId: changedCommittedMutationId,
      snapshot: changedSnapshot,
      nowMs: 10,
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_CONFLICT' });
    expect(await tableCount(database, 'artifact_references'))
      .toBe(artifactCountBeforeConflict);
    expect(await (await database.db.prepare(`
      SELECT count(*) AS count
      FROM artifact_references
      WHERE org_id = ? AND digest_sha256 = ?
    `)).get(
      TENANT.orgId,
      changedSnapshot.digestSha256,
    )).toMatchObject({ count: 0 });
  });

  test('serves an exact retained Preview server artifact and its real bindings', async () => {
    const canvasId = uuid(820);
    const chatId = uuid(821);
    const draftId = uuid(822);
    const definitionId = uuid(823);
    const previewId = uuid(824);
    const previewRevisionId = uuid(825);
    const resourceId = uuid(826);
    const previewTenant = fnFreezeTenantContext({ ...TENANT, canvasId });
    await database.forTenant(TENANT).canvas.create({
      id: canvasId,
      name: 'Function Preview canvas',
    });
    await service.authoringStore.createChat(previewTenant, {
      id: chatId,
      canvasId,
      externalSessionKey: 'function-preview-chat',
      name: 'Function Preview chat',
      workspaceRelativePath: 'chats/function-preview',
      historyRelativePath: 'history/function-preview.jsonl',
      nowMs: 1,
    });
    await service.authoringStore.createDraft(previewTenant, {
      id: draftId,
      chatId,
      definitionId,
      name: 'Function Preview draft',
      sourceRelativePath: 'drafts/function-preview',
      nowMs: 2,
    });
    await (await database.db.prepare(`
      INSERT INTO widget_definitions (
        org_id, id, slug, name, status, active_revision_id,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'function-preview', 'Function Preview', 'draft', NULL, 2, 2)
    `)).run(TENANT.orgId, definitionId);
    await (await database.db.prepare(`
      INSERT INTO resource_catalog (
        org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'kv', 'Function Preview store', 'ready', NULL, 2, 2)
    `)).run(TENANT.orgId, resourceId);
    await service.authoringStore.ensurePreviewOwner(previewTenant, {
      id: previewId,
      canvasId,
      frameNodeId: 'function-preview-frame',
      draftId,
      originChatId: chatId,
      role: 'placed',
      nowMs: 3,
    });

    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Function Preview',
      slug: 'function-preview',
      ui: capsuleUi('src/ui.ts'),
      server: {
        entry: 'src/server.server.ts',
        runtimeAbi: 'vibecanvas:function-preview-test',
      },
      resources: [{
        slot: 'notes',
        kind: 'kv',
        effect: 'read',
        required: true,
      }],
    };
    const sourceSnapshotId = uuid(827);
    const sourceBytes = new TextEncoder().encode('retained-preview-source');
    const unsignedUiBytes = new TextEncoder().encode('retained-preview-unsigned-ui');
    const uiBytes = new TextEncoder().encode('retained-preview-ui');
    const retainedServerBytes = new TextEncoder().encode('retained-preview-server');
    const sourceDigestSha256 = sha256(sourceBytes);
    const committedMutationId = 'mutation-retained-preview-function';
    await (await database.db.prepare(`
      UPDATE agent_drafts
      SET status = 'ready', source_digest_sha256 = ?,
        committed_mutation_id = ?, build_sequence = 1, updated_at_ms = 4
      WHERE org_id = ? AND id = ?
    `)).run(
      sourceDigestSha256,
      committedMutationId,
      TENANT.orgId,
      draftId,
    );
    await expect(service.authoringStore.compareAndSetPreviewOwner(previewTenant, {
      previewId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      status: 'building',
      activeRevisionId: null,
      pendingBuildId: previewRevisionId,
      lastError: null,
      expectedBindingRevision: 0,
      nextBindingRevision: 0,
      expectedBindingPlanDigestSha256: null,
      nextBindingPlanDigestSha256: fnWidgetPreviewBindingPlanDigest({
        bindings: [{
          slot: 'notes',
          resourceId,
          kind: 'kv',
          allowRead: true,
          allowWrite: false,
        }],
        digestSha256: sha256,
      }),
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      nowMs: 4,
    })).resolves.toMatchObject({
      status: 'building',
      buildSequence: 1,
    });

    const artifactBlobs = new LocalWidgetArtifactStore({
      orgId: TENANT.orgId,
      artifactsRoot,
    });
    const storeArtifact = async (
      id: string,
      kind: TWidgetArtifactDescriptor['kind'],
      bytes: Uint8Array,
    ): Promise<TWidgetArtifactDescriptor> => {
      const stored = await artifactBlobs.writeArtifact({ kind, bytes });
      await (await database.db.prepare(`
        INSERT INTO artifact_references (
          org_id, id, kind, digest_sha256, byte_size,
          retention_state, retain_until_ms, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, 'pinned', NULL, 5)
      `)).run(TENANT.orgId, id, kind, stored.digestSha256, stored.byteSize);
      return Object.freeze({
        orgId: TENANT.orgId,
        id,
        kind,
        digestSha256: stored.digestSha256,
        byteSize: stored.byteSize,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 5,
      });
    };
    const [
      sourceArtifact,
      unsignedUiArtifact,
      uiArtifact,
      serverArtifactFixture,
    ] = await Promise.all([
      storeArtifact(uuid(830), 'source', sourceBytes),
      storeArtifact(uuid(831), 'unsigned_ui', unsignedUiBytes),
      storeArtifact(uuid(832), 'ui', uiBytes),
      storeArtifact(uuid(833), 'server', retainedServerBytes),
    ]);
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
    const functionDescriptors = [{
      schemaVersion: 1 as const,
      exportName: 'readNotes',
      modulePath: 'src/server.server.ts',
      effect: 'fx' as const,
      inputSchema: {},
      outputSchema: {},
      resources: [{ slot: 'notes', effect: 'read' as const }],
      limits: {
        timeoutMs: 1_000,
        memoryTier: 'small' as const,
        outputByteLimit: 1_024,
        logByteLimit: 1_024,
      },
      retry: {
        mode: 'none' as const,
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
      },
    }];
    const functionDescriptorsJson =
      fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors);
    const functionDescriptorsDigestSha256 = sha256(functionDescriptorsJson);
    const uiRuntime = capsuleRuntimeDescriptor(
      manifest,
      `sha256:${unsignedUiArtifact.digestSha256}`,
      'vibecanvas-preview-v1',
    );
    const capabilityContractDigestSha256 = sha256(
      fnCanonicalizeWidgetCapsuleCapabilityRequests(uiRuntime.capabilityRequests),
    );
    const channelContractDigestSha256 = sha256(
      fnCanonicalizeWidgetCapsuleChannelContract(uiRuntime.channels),
    );
    const distributionProvenance: TWidgetDistributionBuildProvenance = {
      kind: 'external-distribution',
      producer: {
        name: 'widget-service-preview-function-test',
        version: '1',
        digest: `sha256:${'1'.repeat(64)}`,
      },
      sourceRevision: sourceDigestSha256,
      dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
      buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
    };
    const constructionContractDigestSha256 = sha256(
      fnCanonicalizeWidgetConstructionContractPayload({
        sourceSnapshotId,
        sourceDigestSha256,
        sourceArtifactDigestSha256: sourceArtifact.digestSha256,
        canonicalManifestJson,
        unsignedUiDigestSha256: unsignedUiArtifact.digestSha256,
        capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
        target: uiRuntime.target,
        budgets: uiRuntime.budgets,
        capabilityContractDigestSha256,
        channelContractDigestSha256,
        serverDigestSha256: serverArtifactFixture.digestSha256,
        serverRuntimeAbi: manifest.server!.runtimeAbi,
        functionDescriptorsDigestSha256,
        builderIdentity: BUILDER_IDENTITY,
        capsuleBuildIdentity: CAPSULE_PUBLICATION_IDENTITY.capsuleBuildIdentity,
        buildPolicyId: CAPSULE_PUBLICATION_IDENTITY.buildPolicyId,
        distributionProvenance,
      }),
    );
    const previewContractDigestSha256 = sha256(
      fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson,
        uiDigestSha256: uiArtifact.digestSha256,
        capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
        target: uiRuntime.target,
        budgets: uiRuntime.budgets,
        capabilityContractDigestSha256,
        channelContractDigestSha256,
        signatureKeyIds: uiRuntime.signatureKeyIds,
        serverDigestSha256: serverArtifactFixture.digestSha256,
        serverRuntimeAbi: manifest.server!.runtimeAbi,
        functionDescriptorsDigestSha256,
        sourceDigestSha256,
        builderIdentity: BUILDER_IDENTITY,
        capsuleBuildIdentity: CAPSULE_PUBLICATION_IDENTITY.capsuleBuildIdentity,
        buildPolicyId: CAPSULE_PUBLICATION_IDENTITY.buildPolicyId,
      }),
    );
    await expect(service.authoringStore.commitPreview(previewTenant, {
      expectedActiveRevisionId: null,
      expectedBuildSequence: 1,
      revision: {
        id: previewRevisionId,
        previewId,
        draftId,
        definitionId,
        draftRevisionSha256: sourceDigestSha256,
        committedMutationId,
        sourceSnapshotId,
        sourceDigestSha256,
        sourceArtifact,
        manifest,
        canonicalManifestJson,
        functionDescriptors,
        functionDescriptorsDigestSha256,
        capabilityContractDigestSha256,
        channelContractDigestSha256,
        constructionContractDigestSha256,
        previewContractDigestSha256,
        builderIdentity: BUILDER_IDENTITY,
        capsuleBuildIdentity: CAPSULE_PUBLICATION_IDENTITY.capsuleBuildIdentity,
        buildPolicyId: CAPSULE_PUBLICATION_IDENTITY.buildPolicyId,
        distributionProvenance,
        unsignedUiArtifact,
        uiArtifact,
        uiRuntime,
        serverArtifact: serverArtifactFixture,
        serverRuntimeAbi: manifest.server!.runtimeAbi,
        bindingRevision: 0,
        bindingPlanDigestSha256: fnWidgetPreviewBindingPlanDigest({
          bindings: [{
            slot: 'notes',
            resourceId,
            kind: 'kv',
            allowRead: true,
            allowWrite: false,
          }],
          digestSha256: sha256,
        }),
        buildSequence: 1,
        diagnostics: [],
        createdAtMs: 5,
      },
      bindings: [{
        slot: 'notes',
        resourceId,
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      }],
      nowMs: 5,
    })).resolves.toMatchObject({
      status: 'committed',
      revision: { id: previewRevisionId },
    });

    const target = await service.resolvePreviewFunctionTarget(previewTenant, {
      previewId,
      revisionId: previewRevisionId,
    });
    expect(target).toMatchObject({
      revision: {
        id: previewRevisionId,
        definitionId,
        serverRuntimeAbi: manifest.server!.runtimeAbi,
      },
      bindings: [{
        slot: 'notes',
        resourceId,
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      }],
    });
    const serverArtifact = target?.revision.serverArtifact;
    if (!target || !serverArtifact) throw new Error('Expected retained Preview server artifact.');
    const serverBytes = await service.readPreviewServerArtifact(previewTenant, {
      previewId,
      revisionId: previewRevisionId,
      definitionId,
      artifactId: serverArtifact.id,
      artifactDigestSha256: serverArtifact.digestSha256,
      contractDigestSha256: target.revision.previewContractDigestSha256,
      runtimeAbi: manifest.server!.runtimeAbi,
    });
    expect(serverBytes).not.toBeNull();
    expect(serverBytes?.byteLength).toBe(serverArtifact.byteSize);

    await (await database.db.prepare(`
      UPDATE agent_previews
      SET active_revision_id = ?, updated_at_ms = 6
      WHERE org_id = ? AND id = ?
    `)).run(uuid(828), TENANT.orgId, previewId);
    await expect(service.resolvePreviewFunctionTarget(previewTenant, {
      previewId,
      revisionId: previewRevisionId,
    })).resolves.toMatchObject({
      revision: { id: previewRevisionId },
    });
    await expect(service.resolvePreviewFunctionTarget(previewTenant, {
      previewId,
      revisionId: uuid(829),
    })).resolves.toBeNull();
    await expect(service.resolvePreviewFunctionTarget(OTHER_ACCOUNT_TENANT, {
      previewId,
      revisionId: previewRevisionId,
    })).resolves.toBeNull();
    const exactArtifactRequest = {
      previewId,
      revisionId: previewRevisionId,
      definitionId,
      artifactId: serverArtifact.id,
      artifactDigestSha256: serverArtifact.digestSha256,
      contractDigestSha256: target.revision.previewContractDigestSha256,
      runtimeAbi: manifest.server!.runtimeAbi,
    };
    await expect(service.readPreviewServerArtifact(previewTenant, {
      ...exactArtifactRequest,
      revisionId: uuid(829),
    })).resolves.toBeNull();
    await expect(service.readPreviewServerArtifact(
      OTHER_ACCOUNT_TENANT,
      exactArtifactRequest,
    )).resolves.toBeNull();
  }, 20_000);

  test('validates, previews, and publishes exact pinned React TSX through Capsule', async () => {
    const sourceRoot = join(root, 'react-capsule-source');
    await writeSource(sourceRoot, {
      'ui/main.tsx': [
        'import { getWidgetProps, getWidgetTheme } from "@vibecanvas/sdk/widget";',
        'import { useState } from "react";',
        'import { createRoot } from "react-dom/client";',
        'import "./styles.css";',
        '',
        'function Counter() {',
        '  const props = getWidgetProps<{ label: string }>();',
        '  const theme = getWidgetTheme();',
        '  const [count, setCount] = useState(0);',
        '  return (',
        '    <button style={{ color: theme.tokens.foreground }} type="button" onClick={() => setCount(count + 1)}>',
        '      {props.label}: {count}',
        '    </button>',
        '  );',
        '}',
        '',
        'createRoot(document.body).render(<Counter />);',
        '',
      ].join('\n'),
      'ui/styles.css': 'button { color: red; }',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(844),
      createdAtMs: 30,
    });
    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'React Capsule widget',
      slug: 'react-capsule-widget',
      ui: capsuleUi('ui/main.tsx', ['artifact-resources-v1']),
    };

    await expect(service.validateBuild(TENANT, {
      snapshot,
      manifest,
    })).resolves.toEqual({ valid: true, diagnostics: [] });

    const preview = await service.buildPreview(TENANT, {
      draftId: uuid(845),
      definitionId: uuid(846),
      draftRevisionSha256: snapshot.digestSha256,
      committedMutationId: 'mutation-react-capsule-preview',
      snapshot,
      manifest,
      builderIdentity: BUILDER_IDENTITY,
      ...CAPSULE_PUBLICATION_IDENTITY,
    });
    expect(preview.uiArtifact.bytes.byteLength).toBeGreaterThan(0);
    expect(preview.uiArtifact.capsuleArtifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(preview.uiArtifact.runtimeDescriptor.signatureKeyIds).toEqual([
      'vibecanvas-preview-v1',
    ]);

    const published = await service.publish(TENANT, {
      definitionId: uuid(846),
      revisionId: uuid(847),
      expectedActiveRevisionId: null,
      snapshot,
      manifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      ...CAPSULE_PUBLICATION_IDENTITY,
      nowMs: 31,
    });
    expect(published.status).toBe('committed');
    if (published.status !== 'committed') throw new Error('Expected React publication to commit.');
    expect(published.revision.uiRuntime.signatureKeyIds).toEqual([
      'vibecanvas-release-v1',
    ]);
    expect(published.revision.uiRuntime.capsuleArtifactHash).toBe(
      preview.uiArtifact.capsuleArtifactHash,
    );
    expect(published.revision.uiArtifact.digestSha256).not.toBe(
      preview.uiArtifact.digestSha256,
    );
  }, 20_000);

  test('validates and previews the generated React theme-channel widget through Capsule', async () => {
    const sourceRoot = join(root, 'react-theme-widget-source');
    await writeSource(sourceRoot, {
      'ui/main.tsx': [
        'import { getWidgetTheme, subscribeWidgetTheme } from "@vibecanvas/sdk/widget";',
        'import { useEffect, useState } from "react";',
        'import { createRoot } from "react-dom/client";',
        'import "./styles.css";',
        '',
        'function HelloWorld() {',
        '  const [theme, setTheme] = useState(getWidgetTheme);',
        '  useEffect(() => subscribeWidgetTheme(setTheme), []);',
        '',
        '  return (',
        '    <main',
        '      className="hello-world-widget"',
        '      style={{',
        '        backgroundColor: theme.tokens.background,',
        '        color: theme.tokens.foreground,',
        '      }}',
        '    >',
        '      <section',
        '        className="hello-world-widget__card"',
        '        aria-labelledby="hello-title"',
        '        style={{',
        '          backgroundColor: theme.tokens.surface,',
        '          color: theme.tokens.surfaceForeground,',
        '          borderColor: theme.tokens.border,',
        '        }}',
        '      >',
        '        <h1 id="hello-title">Hello, world!</h1>',
        '        <p style={{ color: theme.tokens.mutedForeground }}>',
        '          This example widget is rendered with React.',
        '        </p>',
        '      </section>',
        '    </main>',
        '  );',
        '}',
        '',
        'const container = document.createElement("div");',
        'document.body.append(container);',
        'createRoot(container).render(<HelloWorld />);',
        '',
      ].join('\n'),
      'ui/main.ts': '\n',
      'ui/styles.css': [
        '.hello-world-widget {',
        '  box-sizing: border-box;',
        '  display: grid;',
        '  width: 100%;',
        '  height: 100%;',
        '  place-items: center;',
        '  padding: 20px;',
        '  overflow: auto;',
        '  font: 14px/1.5 system-ui, sans-serif;',
        '}',
        '',
        '.hello-world-widget * { box-sizing: border-box; }',
        '',
        '.hello-world-widget__card {',
        '  display: grid;',
        '  justify-items: center;',
        '  gap: 14px;',
        '  max-width: 28rem;',
        '  padding: 24px;',
        '  text-align: center;',
        '  border: 1px solid;',
        '  border-radius: 14px;',
        '}',
        '',
        '.hello-world-widget h1,',
        '.hello-world-widget p { margin: 0; }',
        '',
      ].join('\n'),
      'vibecanvas.json': `${JSON.stringify({
        schemaVersion: 3,
        name: 'Hello World',
        slug: 'hello-world',
        description: 'A simple React hello world widget.',
        ui: capsuleUi('ui/main.tsx', ['artifact-resources-v1']),
      }, null, 2)}\n`,
      'package.json': `${JSON.stringify({
        name: 'hello-world',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: {
          '@vibecanvas/sdk': 'file:/trusted/widget-sdk',
          react: '19.2.7',
          'react-dom': '19.2.7',
          zod: '4.4.3',
        },
        devDependencies: {
          '@types/react': '19.2.17',
          '@types/react-dom': '19.2.3',
          typescript: '5.9.3',
        },
      }, null, 2)}\n`,
      'tsconfig.json': `${JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          jsx: 'react-jsx',
          lib: ['ES2022', 'DOM'],
        },
        include: ['ui/**/*.ts', 'ui/**/*.tsx', 'server/**/*.ts', 'shared/**/*.ts'],
      }, null, 2)}\n`,
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(850),
      createdAtMs: 40,
    });
    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Hello World',
      slug: 'hello-world',
      description: 'A simple React hello world widget.',
      ui: capsuleUi('ui/main.tsx', ['artifact-resources-v1']),
    };

    await expect(service.validateBuild(TENANT, {
      snapshot,
      manifest,
    })).resolves.toEqual({ valid: true, diagnostics: [] });

    const preview = await service.buildPreview(TENANT, {
      draftId: uuid(851),
      definitionId: uuid(852),
      draftRevisionSha256: snapshot.digestSha256,
      committedMutationId: 'mutation-generated-theme-preview',
      snapshot,
      manifest,
      builderIdentity: BUILDER_IDENTITY,
      ...CAPSULE_PUBLICATION_IDENTITY,
    });
    expect(preview.uiArtifact.bytes.byteLength).toBeGreaterThan(0);
    expect(preview.uiArtifact.runtimeDescriptor.signatureKeyIds).toEqual([
      'vibecanvas-preview-v1',
    ]);
  }, 20_000);

  test('fails closed for capability issuance and reads after stored revision contract tampering', async () => {
    const sourceRoot = join(root, 'tampered-contract-source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const marker = "IMMUTABLE_CONTRACT";',
    });
    const snapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(816),
      createdAtMs: 10,
    });
    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Tamper-resistant widget',
      slug: 'tamper-resistant-widget',
      ui: capsuleUi('src/ui.ts'),
    };
    const published = await service.publish(TENANT, {
      definitionId: uuid(817),
      revisionId: uuid(818),
      expectedActiveRevisionId: null,
      snapshot,
      manifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      ...CAPSULE_PUBLICATION_IDENTITY,
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
    expect(await service.readArtifact(TENANT, request)).toHaveLength(artifact.byteSize);

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


  test('publishes separate server/UI artifacts, rolls back by CAS, and collects the inactive revision', async () => {
    const sourceRoot = join(root, 'source');
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export const uiMarker = "UI_REVISION_ONE";',
    });
    const firstSnapshot = await service.captureSource(TENANT, sourceRoot, {
      id: uuid(806),
      createdAtMs: 100,
    });
    const firstManifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Revision widget',
      slug: 'revision-widget',
      ui: capsuleUi('src/ui.ts'),
    };
    const first = await service.publish(TENANT, {
      definitionId: uuid(807),
      revisionId: uuid(808),
      expectedActiveRevisionId: null,
      snapshot: firstSnapshot,
      manifest: firstManifest,
      bindings: [],
      builderIdentity: BUILDER_IDENTITY,
      ...CAPSULE_PUBLICATION_IDENTITY,
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
    const secondManifest: TWidgetManifestV3 = {
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
      ...CAPSULE_PUBLICATION_IDENTITY,
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
    expect(uiBytes).toHaveLength(second.revision.uiArtifact.byteSize);
    expect(Buffer.from(uiBytes!).subarray(0, 1).toString('utf8')).not.toBe('{');
    expect(serverOutputText(serverBytes!)).toContain('SERVER_PRIVATE_MARKER');

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
    const manifest: TWidgetManifestV3 = {
      schemaVersion: 3,
      name: 'Broken server widget',
      slug: 'broken-server-widget',
      ui: capsuleUi('src/ui.ts'),
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
      ...CAPSULE_PUBLICATION_IDENTITY,
      nowMs: 20,
    })).rejects.toMatchObject({ code: 'WIDGET_BUILD_FAILED' });

    expect(await tableCount(database, 'widget_definitions')).toBe(0);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(0);
    expect(await tableCount(database, 'artifact_references')).toBe(0);
    expect(await filesBelow(artifactsRoot)).toEqual([]);
  });

  test('production composition publishes and places immutable revisions', async () => {
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
      version: '0.0.0-test',
      command: 'serve',
      rawArgv: ['bun', 'run'],
      argv: [],
      port: 0,
      home,
      helpRequested: false,
      versionRequested: false,
    };
    const { services } = setupServices(config, {
      capsuleBuild: buildCapsuleGuest,
      distributionBuild: testWidgetDistributionBuild,
    });
    const widgetOwner = services.require('widgetOwner');
    const widgetCapability = services.require('widget');
    const agentOwner = services.require('agent');
    const resourceOwner = services.require('resourceOwner');
    const compositionDatabase = services.require('db');
    const registrations = new Map(
      services.getRegistrations().map((registration) => [registration.name, registration.startOrder]),
    );
    expect(registrations.get('widgetOwner')).toBe(55);
    expect(registrations.get('widget')).toBe(56);
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
          schemaVersion: 3,
          name: 'Placement widget',
          slug: 'placement-widget',
          ui: capsuleUi('src/ui.ts'),
        },
        bindings: [],
        builderIdentity: fnWidgetCapsuleBuilderIdentity({
          npmVersion: 'external',
          serverBunVersion: Bun.version,
        }),
        ...CAPSULE_PUBLICATION_IDENTITY,
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
        name: `published:${published.definition.id}`,
        revision: published.revision.id,
      });
      await expect(agent.resolveWidgetPlacement(reference)).resolves.toMatchObject({
        ok: true,
        descriptor: {
          kind: 'published',
          reference,
          bounds: { width: 360, height: 320 },
          definitionId: published.definition.id,
          revisionId: published.revision.id,
          definitionName: null,
          definitionSlug: 'placement-widget',
        },
      });
    } finally {
      await agentOwner.stop();
      await resourceOwner.stop();
      await widgetOwner.stop();
      await compositionDatabase.stop();
    }
  });
});

describe('WidgetServicePool authoring capability', () => {
  test('preserves the pool receiver for capture and validation delegation', async () => {
    const calls: string[] = [];
    const snapshot = {
      marker: 'captured-source',
    } as unknown as Awaited<ReturnType<WidgetService['captureSource']>>;
    const validation = { valid: true, diagnostics: [] } as const;
    const pool = new WidgetServicePool({
      create: async () => ({
        start: async () => undefined,
        stop: async () => undefined,
        captureSource: async (
          tenant: TTenantContext,
          sourceRoot: string,
          args: Parameters<WidgetService['captureSource']>[2],
        ) => {
          calls.push(`capture:${tenant.requestId}:${sourceRoot}:${args.id}`);
          return snapshot;
        },
        validateBuild: async (
          tenant: TTenantContext,
          request: Parameters<WidgetService['validateBuild']>[1],
        ) => {
          calls.push(`validate:${tenant.requestId}:${request.snapshot === snapshot}`);
          return validation;
        },
      } as unknown as WidgetService),
    });
    pool.start({ hooks: {}, config: {} });
    const authoring = createWidgetAuthoringCapability(pool);

    await expect(authoring.captureSource(TENANT, '/widget/source', {
      id: uuid(898),
    })).resolves.toBe(snapshot);
    await expect(authoring.validateBuild(TENANT, {
      snapshot,
      manifest: {
        schemaVersion: 3,
        name: 'Bound capability',
        slug: 'bound-capability',
        ui: capsuleUi('ui/main.ts'),
      },
    })).resolves.toBe(validation);
    expect(calls).toEqual([
      `capture:${TENANT.requestId}:/widget/source:${uuid(898)}`,
      `validate:${TENANT.requestId}:true`,
    ]);

    await pool.stop();
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

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
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';
import { WidgetService } from '../src/services/WidgetService';

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

const BUILDER_IDENTITY = 'vibecanvas-widget-test/bun';
const TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS = Object.freeze([
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
  | 'widget_definitions'): Promise<number> {
  const query = {
    artifact_references: 'SELECT count(*) AS count FROM artifact_references WHERE org_id = ?',
    legacy_actor_definitions: 'SELECT count(*) AS count FROM legacy_actor_definitions WHERE org_id = ?',
    legacy_actor_instances: 'SELECT count(*) AS count FROM legacy_actor_instances WHERE org_id = ?',
    widget_definition_revisions: 'SELECT count(*) AS count FROM widget_definition_revisions WHERE org_id = ?',
    widget_definitions: 'SELECT count(*) AS count FROM widget_definitions WHERE org_id = ?',
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
    expect(await tableCount(database, 'widget_definitions')).toBe(1);
    expect(await tableCount(database, 'widget_definition_revisions')).toBe(1);
    expect(await tableCount(database, 'artifact_references')).toBe(1);
    expect(await tableCount(database, 'legacy_actor_definitions')).toBe(0);
    expect(await tableCount(database, 'legacy_actor_instances')).toBe(0);

    const artifactFiles = await filesBelow(artifactsRoot);
    expect(artifactFiles).toHaveLength(1);
    expect(artifactFiles[0]).toMatch(/^blobs\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(artifactFiles.some((path) => path.includes('widgets/') || path.includes('actors/'))).toBe(false);

    const expiresAtMs = Date.now() + 30_000;
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
    expect(collected.deleted).toBe(2);
    expect(await service.getRevision(TENANT, second.revision.id)).toBeNull();
    expect(await service.getActiveRevision(TENANT, first.definition.id)).toMatchObject({
      id: first.revision.id,
    });
    expect(await tableCount(database, 'artifact_references')).toBe(1);
    expect(await filesBelow(artifactsRoot)).toHaveLength(1);
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

  test('production composition shares one organization owner and never instantiates the actor pool', async () => {
    const compositionRoot = join(root, 'production-composition');
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
    const { services } = setupServices(config);
    const widgetOwner = services.require('widgetOwner');
    const widgetCapability = services.require('widget');
    const actorOwner = services.require('actor');
    const registrations = new Map(
      services.getRegistrations().map((registration) => [registration.name, registration.startOrder]),
    );
    expect(registrations.get('widgetOwner')).toBe(55);
    expect(registrations.get('widget')).toBe(56);
    expect(registrations.get('actor')).toBe(60);
    expect(Reflect.ownKeys(widgetCapability).sort()).toEqual([
      'getActiveRevision',
      'getArtifact',
      'getRevision',
      'issueBrowserUiArtifactReadCapability',
      'publish',
      'readArtifact',
      'rollback',
    ]);
    expect('issueServerExecutionArtifactReadCapability' in widgetCapability).toBe(false);

    widgetOwner.start({ config: {}, hooks: {} });
    try {
      const first = await widgetOwner.forTenant(TENANT);
      const second = await widgetOwner.forTenant(fnFreezeTenantContext({
        ...TENANT,
        accountId: uuid(899),
        requestId: 'widget-service-second-account',
      }));
      expect(second).toBe(first);
      expect(widgetOwner.getTenantCount()).toBe(1);
      expect(actorOwner.getTenantCount()).toBe(0);
    } finally {
      await widgetOwner.stop();
    }
    expect(actorOwner.getTenantCount()).toBe(0);
  });
});

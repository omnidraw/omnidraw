import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  LocalWidgetArtifactStore,
  WidgetArtifactGarbageCollector,
  WidgetArtifactOperationLane,
} from '@vibecanvas/widget-contract/local';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { WidgetControlStoreTurso } from '../WidgetControlStoreTurso';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const ARTIFACT_ID = '00000000-0000-4000-8000-000000000901';
const CHAT_ID = '00000000-0000-4000-8000-000000000902';
const DRAFT_ID = '00000000-0000-4000-8000-000000000903';
const PREVIEW_ID = '00000000-0000-4000-8000-000000000904';
const tenant = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: DEFAULT_OSS_CELL_ID,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'widget-gc-crash-test',
});

type TDeleteCheckpoint = Readonly<{
  type: 'widget-artifact-unlinked';
  pid: number;
  artifactId: string;
}>;

function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        rejectPromise(error);
      },
    );
  });
}

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error('Delete worker exited before the unlink checkpoint.');
      value += decoder.decode(next.value, { stream: true });
      const newline = value.indexOf('\n');
      if (newline >= 0) return value.slice(0, newline);
    }
  } finally {
    reader.releaseLock();
  }
}

describe('WidgetArtifactGarbageCollector crash recovery', () => {
  let root: string;
  let databasePath: string;
  let artifactsRoot: string;
  let service: DbServiceTurso;
  const children = new Set<ReturnType<typeof Bun.spawn>>();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibecanvas-widget-gc-crash-'));
    databasePath = join(root, 'main.db');
    artifactsRoot = join(root, 'artifacts');
    service = new DbServiceTurso({
      databasePath,
      dataDir: root,
      cacheDir: join(root, 'cache'),
    });
    await service.start();
  });

  afterEach(async () => {
    for (const child of children) {
      child.kill(9);
      await bounded(child.exited, 5_000, 'delete worker exit');
    }
    children.clear();
    await service.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function seedEligibleArtifact(): Promise<Readonly<{
    blobs: LocalWidgetArtifactStore;
    digestSha256: string;
  }>> {
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot,
    });
    const stored = await blobs.writeArtifact({
      kind: 'ui',
      bytes: new TextEncoder().encode('crash-safe widget artifact'),
    });
    await (await service.db.prepare(`
      INSERT INTO artifact_references (
        org_id, id, kind, digest_sha256, byte_size,
        retention_state, retain_until_ms, created_at_ms
      ) VALUES (?, ?, 'ui', ?, ?, 'eligible', 1, 1)
    `)).run(tenant.orgId, ARTIFACT_ID, stored.digestSha256, stored.byteSize);
    await (await service.db.prepare(`
      INSERT INTO agent_chats (
        org_id, id, account_id, canvas_id, name, status,
        workspace_relative_path, history_relative_path, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, NULL, 'Crash preview', 'active',
        'chats/crash-preview', 'history/crash-preview.jsonl', 1, 1)
    `)).run(tenant.orgId, CHAT_ID, tenant.accountId);
    await (await service.db.prepare(`
      INSERT INTO agent_drafts (
        org_id, id, chat_id, name, status, source_relative_path,
        source_digest_sha256, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Crash preview', 'ready', 'drafts/crash-preview',
        ?, NULL, 1, 1)
    `)).run(tenant.orgId, DRAFT_ID, CHAT_ID, '1'.padStart(64, '0'));
    await (await service.db.prepare(`
      INSERT INTO agent_previews (
        org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
        status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?, 'ui', 'previews/crash-preview',
        'stopped', NULL, 1, 1, 1000)
    `)).run(tenant.orgId, PREVIEW_ID, DRAFT_ID, ARTIFACT_ID);
    return Object.freeze({ blobs, digestSha256: stored.digestSha256 });
  }

  async function artifactRow(): Promise<unknown | null> {
    return (await (await service.db.prepare(`
      SELECT retention_state, retain_until_ms
      FROM artifact_references
      WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, ARTIFACT_ID)) ?? null;
  }

  async function previewRow(): Promise<unknown | null> {
    return (await (await service.db.prepare(`
      SELECT status, artifact_id, artifact_kind
      FROM agent_previews
      WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, PREVIEW_ID)) ?? null;
  }

  function collector(blobs: LocalWidgetArtifactStore): WidgetArtifactGarbageCollector {
    const controlStore = new WidgetControlStoreTurso(service.db);
    return new WidgetArtifactGarbageCollector({
      controlStore,
      mutationCoordinator: controlStore,
      blobs,
      operationLane: new WidgetArtifactOperationLane(),
    });
  }

  test('directory sync failure rolls metadata back only to a durable deleting tombstone', async () => {
    const { blobs: durableBlobs } = await seedEligibleArtifact();
    const failingBlobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot,
      syncDirectory: async () => {
        throw new Error('simulated artifact directory sync failure');
      },
    });

    await expect(collector(failingBlobs).collect(tenant, {
      nowMs: 100,
      gracePeriodMs: 10,
      limit: 10,
    })).rejects.toThrow('simulated artifact directory sync failure');
    expect(await artifactRow()).toEqual({ retention_state: 'deleting', retain_until_ms: 1 });
    expect(await previewRow()).toEqual({
      status: 'stopped',
      artifact_id: ARTIFACT_ID,
      artifact_kind: 'ui',
    });
    expect(await durableBlobs.listBlobDigests()).toEqual([]);

    expect(await collector(durableBlobs).collect(tenant, {
      nowMs: 101,
      gracePeriodMs: 10,
      limit: 10,
    })).toMatchObject({ deleted: 1 });
    expect(await artifactRow()).toBeNull();
    expect(await previewRow()).toEqual({ status: 'stopped', artifact_id: null, artifact_kind: null });
    expect(await durableBlobs.listBlobDigests()).toEqual([]);
  });

  test('SIGKILL after unlink rolls metadata back to deleting and restart completes idempotently', async () => {
    const { blobs: durableBlobs, digestSha256 } = await seedEligibleArtifact();
    const fixturePath = join(import.meta.dir, 'fixtures', 'widget-artifact-delete-crash.ts');
    const bunExecutable = Bun.which('bun') ?? process.execPath;
    const worker = Bun.spawn([
      bunExecutable,
      fixturePath,
      databasePath,
      root,
      artifactsRoot,
      ARTIFACT_ID,
    ], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.add(worker);

    let checkpoint: TDeleteCheckpoint;
    try {
      checkpoint = JSON.parse(await bounded(
        readLine(worker.stdout),
        10_000,
        'artifact unlink checkpoint',
      )) as TDeleteCheckpoint;
    } catch (error) {
      worker.kill(9);
      await bounded(worker.exited, 5_000, 'failed delete worker exit');
      children.delete(worker);
      const stderr = await new Response(worker.stderr).text();
      throw new Error(`Delete worker failed before unlink: ${stderr}`, { cause: error });
    }

    expect(checkpoint).toEqual({
      type: 'widget-artifact-unlinked',
      pid: worker.pid,
      artifactId: ARTIFACT_ID,
    });
    worker.kill(9);
    expect(await bounded(worker.exited, 5_000, 'killed delete worker exit')).not.toBe(0);
    children.delete(worker);

    expect(await artifactRow()).toEqual({ retention_state: 'deleting', retain_until_ms: 1 });
    expect(await previewRow()).toEqual({
      status: 'stopped',
      artifact_id: ARTIFACT_ID,
      artifact_kind: 'ui',
    });
    expect(await durableBlobs.listBlobDigests()).toEqual([]);
    const controlStore = new WidgetControlStoreTurso(service.db);
    expect(await controlStore.activatePreviewArtifact(tenant, {
      previewId: PREVIEW_ID,
      artifactId: ARTIFACT_ID,
      expectedDigestSha256: digestSha256,
      nowMs: 101,
    })).toBe(false);
    expect(await artifactRow()).toEqual({ retention_state: 'deleting', retain_until_ms: 1 });
    expect(await previewRow()).toEqual({
      status: 'stopped',
      artifact_id: ARTIFACT_ID,
      artifact_kind: 'ui',
    });
    expect(await collector(durableBlobs).collect(tenant, {
      nowMs: 101,
      gracePeriodMs: 10,
      limit: 10,
    })).toMatchObject({ deleted: 1 });
    expect(await artifactRow()).toBeNull();
    expect(await previewRow()).toEqual({ status: 'stopped', artifact_id: null, artifact_kind: null });
  }, 20_000);
});

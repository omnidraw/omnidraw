import { afterEach, describe, expect, test } from 'bun:test';
import type { IResourceUseCoordinator } from '@vibecanvas/resource-runtime';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../packages/service-db/src/CONSTANTS';
import { DbServiceTurso } from '../packages/service-db/src/DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '../packages/service-db/src/ResourceControlStoreTurso';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { ResourceService } from '../apps/cli/src/services/ResourceService';

const REPO_ROOT = resolve(import.meta.dir, '..');
const children = new Set<ReturnType<typeof Bun.spawn>>();
const tenant: TTenantContext = {
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: '00000000-0000-4000-8000-0000000000f4',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'resource-boundary-request',
};
const useCoordinator: IResourceUseCoordinator = {
  inspect: async (_tenant, resourceId) => ({ resourceId, uses: [] }),
  drain: async (_tenant, request) => ({
    ok: true,
    lease: {
      resourceId: request.resourceId,
      leaseId: 'resource-boundary-empty-lease',
      leaseEpoch: 1,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      drainedUses: [],
    },
  }),
  release: async (_tenant, lease, mode) => ({
    resourceId: lease.resourceId,
    released: true,
    mode,
    resumedUseIds: [],
  }),
};

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

async function openFileNames(pid: number): Promise<string[]> {
  const procFd = `/proc/${pid}/fd`;
  if (await stat(procFd).then(() => true, () => false)) {
    const names = await readdir(procFd);
    return (await Promise.all(names.map((name) => (
      readlink(join(procFd, name)).catch(() => '')
    )))).filter(Boolean);
  }

  const command = Bun.spawn(['lsof', '-Fn', '-p', String(pid)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, output] = await Promise.all([
    command.exited,
    new Response(command.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error(`Unable to inspect open files for process ${pid}.`);
  return output.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
}

function resourceDatabaseFiles(files: readonly string[], databasePath: string): string[] {
  return files.filter((file) => file === databasePath || file.startsWith(`${databasePath}-`));
}

const descriptorInspectionAvailable = await openFileNames(process.pid).then(
  () => true,
  () => false,
);
const descriptorInspectionRequired = process.env.VIBECANVAS_REQUIRE_FD_INSPECTION === '1';
const descriptorTest = descriptorInspectionAvailable || descriptorInspectionRequired ? test : test.skip;

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let value = '';
  while (true) {
    const next = await reader.read();
    if (next.done) throw new Error('Logical executor exited before returning a line.');
    value += decoder.decode(next.value, { stream: true });
    const newline = value.indexOf('\n');
    if (newline >= 0) return value.slice(0, newline);
  }
}

afterEach(async () => {
  for (const child of children) {
    child.kill();
    await child.exited;
  }
  children.clear();
});

describe('M4 resource runtime boundaries', () => {
  test('provides file-descriptor inspection when final acceptance requires it', () => {
    if (!descriptorInspectionRequired) return;
    expect(
      descriptorInspectionAvailable,
      'VIBECANVAS_REQUIRE_FD_INSPECTION=1 requires readable /proc/<pid>/fd or a working lsof command.',
    ).toBe(true);
  });

  test('keeps resource-runtime independent from actor and API implementations', async () => {
    const roots = [
      join(REPO_ROOT, 'packages/resource-runtime/src'),
      join(REPO_ROOT, 'packages/api/src/resource'),
    ];
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const name = relative(REPO_ROOT, file);
      if (file.includes(`${sep}resource-runtime${sep}`) && /@vibecanvas\/(?:service-actor|service-db|api)/.test(source)) {
        violations.push(`${name}: resource runtime imports an actor/database/API implementation`);
      }
      if (file.includes(`${sep}api${sep}src${sep}resource${sep}`) && /@vibecanvas\/(?:service-actor|service-db)/.test(source)) {
        violations.push(`${name}: neutral resource API imports an actor/database implementation`);
      }
      if (file.includes(`${sep}resource-runtime${sep}src${sep}local${sep}`) && /multiprocess_wal/.test(source)) {
        violations.push(`${name}: local resource provider enables multiprocess WAL`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('keeps browser clients off actor-owned resource routes', async () => {
    const roots = [
      join(REPO_ROOT, 'apps/frontend/src'),
      join(REPO_ROOT, 'packages/ui-ai-chat/src'),
      join(REPO_ROOT, 'packages/canvas/src'),
    ];
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/\.api\.actors\.(?:resources|dbResources|resourceData|resourceSecrets)/.test(source)) {
        violations.push(relative(REPO_ROOT, file));
      }
    }
    expect(violations).toEqual([]);
  });

  descriptorTest('restricts physical files to the production Resource Store owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-fd-'));
    const dataRoot = join(root, 'resources');
    const dbService = new DbServiceTurso({
      databasePath: join(root, 'main.db'),
      dataDir: root,
      cacheDir: root,
    });
    let owner: ResourceService | null = null;
    let contender: ResourceService | null = null;
    const executorPath = join(REPO_ROOT, 'scripts/fixtures/resource-logical-executor.mjs');

    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      const db = dbService.forTenant(tenant);
      await db.actor.insertDefinition({
        name: 'boundary-settings',
        slug: 'boundary-settings',
        url: null,
        description: null,
        manifest_path: 'widgets/boundary-settings/vibecanvas.json',
      });
      const createService = () => new ResourceService({
        tenant,
        db,
        controlStore,
        dataRoot,
        useCoordinator,
      });
      owner = createService();
      owner.attachConsumer({
        getVibecanvasJson: (definitionName) => definitionName === 'boundary-settings'
          ? {
              actor: {
                resources: {
                  settings: {
                    kind: 'db' as const,
                    required: true,
                    scope: ['read' as const, 'write' as const],
                    arbitrarySql: false,
                    operations: {
                      getSetting: {
                        effect: 'read' as const,
                        sql: 'SELECT value FROM settings WHERE name = :name',
                        parameters: { name: { type: 'string' as const } },
                        result: 'rows' as const,
                      },
                    },
                  },
                },
              },
            }
          : null,
      });
      await owner.start({ config: {}, hooks: {} });
      const resource = await owner.createResource(tenant, {
        kind: 'db',
        name: 'Boundary database',
      });
      await owner.executeDbLiveSql(tenant, {
        resourceId: resource.id,
        sql: 'CREATE TABLE settings (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT',
        approved: true,
      });
      await owner.executeDbLiveSql(tenant, {
        resourceId: resource.id,
        sql: "INSERT INTO settings (name, value) VALUES ('theme', 'dark')",
        approved: true,
      });
      await owner.bindResource(tenant, {
        definitionName: 'boundary-settings',
        slot: 'settings',
        resourceId: resource.id,
      });
      const canonicalDataPath = await realpath(join(dataRoot, resource.id, 'data.db'));

      const ownerFiles = await openFileNames(process.pid);
      expect(ownerFiles).toContain(canonicalDataPath);
      expect(resourceDatabaseFiles(ownerFiles, canonicalDataPath).length).toBeGreaterThan(0);

      contender = createService();
      await expect(contender.start({ config: {}, hooks: {} })).rejects.toMatchObject({
        code: 'RESOURCE_OWNER_CONFLICT',
      });

      const child = Bun.spawn([
        'node',
        '--experimental-permission',
        `--allow-fs-read=${executorPath}`,
        executorPath,
        canonicalDataPath,
      ], {
        cwd: REPO_ROOT,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      children.add(child);
      const reader = child.stdout.getReader();
      const ready = JSON.parse(await readLine(reader)) as {
        readonly pid: number;
        readonly type: string;
        readonly physicalOpen: { readonly allowed: boolean; readonly code: string | null };
      };
      expect(ready.type).toBe('ready');
      expect(ready.physicalOpen).toEqual({ allowed: false, code: 'ERR_ACCESS_DENIED' });

      const executorFiles = await openFileNames(ready.pid);
      expect(resourceDatabaseFiles(executorFiles, canonicalDataPath)).toEqual([]);
      expect(executorFiles.some((path) => path.endsWith(`${sep}data.db`))).toBe(false);

      const logicalCall = {
        consumerId: 'boundary-executor',
        definitionName: 'boundary-settings',
        invocationId: 1,
        functionClass: 'fx' as const,
        slot: 'settings',
        kind: 'db' as const,
        operation: 'invoke',
        args: { operation: 'getSetting', parameters: { name: 'theme' } },
      };
      child.stdin.write(`${JSON.stringify({ type: 'invoke', id: 'call-a', call: logicalCall })}\n`);
      child.stdin.flush();
      const request = JSON.parse(await readLine(reader)) as {
        readonly type: string;
        readonly id: string;
        readonly call: typeof logicalCall;
      };
      expect(request).toEqual({
        type: 'resource-call',
        id: 'call-a',
        call: logicalCall,
      });
      const output = await owner.call(tenant, request.call);
      child.stdin.write(`${JSON.stringify({ type: 'resource-result', id: request.id, output })}\n`);
      child.stdin.flush();
      expect(JSON.parse(await readLine(reader))).toEqual({
        type: 'logical-result',
        id: 'call-a',
        output: [{ value: 'dark' }],
      });

      const fixture = await readFile(executorPath, 'utf8');
      expect(fixture).not.toMatch(/data\.db|resources\//);
      reader.releaseLock();

      await owner.stop();
      owner = null;
      expect(resourceDatabaseFiles(await openFileNames(process.pid), canonicalDataPath)).toEqual([]);
    } finally {
      await contender?.stop().catch(() => undefined);
      await owner?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

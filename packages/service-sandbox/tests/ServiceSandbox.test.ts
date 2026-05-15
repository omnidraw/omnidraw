import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '@vibecanvas/service-db/schema';
import { ServiceSandbox, SERVICE_SANDBOX_IMAGE } from '../src/index';

const sqlites: Database[] = [];

afterEach(() => {
  for (const sqlite of sqlites.splice(0)) sqlite.close();
});

describe('ServiceSandbox', () => {
  test('creates tagged reusable volume row and starts pinned bun sandbox', async () => {
    const sqlite = createSqlite();
    const db = drizzle({ client: sqlite, schema });
    const fake = createFakeMicrosandbox();
    const service = new ServiceSandbox({
      db,
      namespace: 'test-run',
      sandboxName: 'vc-test-sandbox',
      workerFiles: [{ content: 'console.log("worker")', sandboxPath: '/home/vibecanvas/worker/worker.mjs' }],
      startCommand: { cmd: 'bun', args: ['/home/vibecanvas/worker/worker.mjs'] },
      loadMicrosandbox: async () => fake.module,
    });

    await service.start();

    const instance = db.query.sandbox_instances.findFirst().sync();
    const row = db.query.sandbox_volumes.findFirst().sync();
    expect(instance?.status).toBe('running');
    expect(instance?.image).toBe(SERVICE_SANDBOX_IMAGE);
    expect(row?.sandbox_instance_id).toBe(instance?.id);
    expect(row?.status).toBe('ready');
    expect(row?.reusable).toBe(true);
    expect(row?.volume_tag).toContain('bun-1.3.14');
    expect(fake.createdSandboxes[0]?.image).toBe(SERVICE_SANDBOX_IMAGE);
    expect(fake.copiedText['/home/vibecanvas/worker/worker.mjs']).toBe('console.log("worker")');
    expect(fake.startedCommands[0]).toEqual({ cmd: 'bun', args: ['/home/vibecanvas/worker/worker.mjs'] });

    await service.stop();
  });

  test('marks reusable db volume missing when it is absent on host', async () => {
    const sqlite = createSqlite();
    const db = drizzle({ client: sqlite, schema });
    const fake = createFakeMicrosandbox();
    const baseConfig = { db, namespace: 'missing-test', sandboxName: 'vc-missing-test', loadMicrosandbox: async () => fake.module };
    const first = new ServiceSandbox(baseConfig);
    await first.start();
    await first.stop();

    const readyRow = db.query.sandbox_volumes.findFirst().sync()!;
    sqlite.run('UPDATE sandbox_volumes SET volume_name = ? WHERE id = ?', ['missing-host-volume', readyRow.id]);
    fake.volumes.splice(0);

    const second = new ServiceSandbox(baseConfig);
    await second.start();

    const missingRow = db.query.sandbox_volumes.findFirst({ where: (table, { eq }) => eq(table.volume_name, 'missing-host-volume') }).sync();
    const readyRows = db.query.sandbox_volumes.findMany({ where: (table, { eq }) => eq(table.status, 'ready') }).sync();
    expect(missingRow?.status).toBe('missing');
    expect(missingRow?.reusable).toBe(false);
    expect(readyRows).toHaveLength(1);

    await second.stop();
  });
});

function createSqlite() {
  const sqlite = new Database(':memory:');
  sqlites.push(sqlite);
  sqlite.run('PRAGMA foreign_keys = ON');
  sqlite.run(`
    CREATE TABLE sandbox_instances (
      id text PRIMARY KEY NOT NULL,
      namespace text DEFAULT 'default' NOT NULL,
      sandbox_name text NOT NULL UNIQUE,
      sandbox_tag text NOT NULL,
      image text NOT NULL,
      setup_hash text NOT NULL,
      status text DEFAULT 'creating' NOT NULL,
      metadata text DEFAULT '{}' NOT NULL,
      last_error text,
      host_checked_at integer,
      created_at integer DEFAULT (unixepoch()) NOT NULL,
      updated_at integer DEFAULT (unixepoch()) NOT NULL
    )
  `);
  sqlite.run(`
    CREATE TABLE sandbox_volumes (
      id text PRIMARY KEY NOT NULL,
      sandbox_instance_id text NOT NULL REFERENCES sandbox_instances(id) ON DELETE cascade,
      namespace text DEFAULT 'default' NOT NULL,
      volume_name text NOT NULL UNIQUE,
      volume_tag text NOT NULL,
      setup_hash text NOT NULL,
      status text DEFAULT 'creating' NOT NULL,
      reusable integer DEFAULT false NOT NULL,
      metadata text DEFAULT '{}' NOT NULL,
      last_error text,
      host_checked_at integer,
      created_at integer DEFAULT (unixepoch()) NOT NULL,
      updated_at integer DEFAULT (unixepoch()) NOT NULL
    )
  `);
  sqlite.run('CREATE INDEX sandbox_instances_tag_idx ON sandbox_instances (namespace, sandbox_tag, status)');
  sqlite.run('CREATE INDEX sandbox_instances_image_idx ON sandbox_instances (image)');
  sqlite.run('CREATE INDEX sandbox_volumes_instance_idx ON sandbox_volumes (sandbox_instance_id)');
  sqlite.run('CREATE INDEX sandbox_volumes_tag_idx ON sandbox_volumes (namespace, volume_tag, status)');
  return sqlite;
}

function createFakeMicrosandbox() {
  const volumes: string[] = [];
  const createdSandboxes: Record<string, unknown>[] = [];
  const copiedText: Record<string, string> = {};
  const startedCommands: { cmd: string; args: readonly string[] }[] = [];
  const sandbox = {
    run: async () => ({ success: true, code: 0, stdout: () => '', stderr: () => '' }),
    shell: async () => ({ success: true, code: 0, stdout: () => '', stderr: () => '' }),
    execStream: async (cmd: string, args: readonly string[] = []) => {
      startedCommands.push({ cmd, args });
      return { kill: async () => undefined };
    },
    fs: () => ({
      write: async (path: string, content: Uint8Array) => {
        copiedText[path] = new TextDecoder().decode(content);
      },
      copyFromHost: async (hostPath: string, sandboxPath: string) => {
        copiedText[sandboxPath] = `copied:${hostPath}`;
      },
    }),
    stopAndWait: async () => undefined,
  };
  return {
    volumes,
    createdSandboxes,
    copiedText,
    startedCommands,
    module: {
      Sandbox: {
        create: async (config: Record<string, unknown>) => {
          createdSandboxes.push(config);
          return sandbox;
        },
        start: async () => {
          throw new Error('not found');
        },
        list: async () => [],
      },
      Volume: {
        create: async ({ name }: { name: string }) => {
          volumes.push(name);
        },
        list: async () => volumes.map((name) => ({ name })),
      },
      Mount: { named: (name: string) => ({ type: 'named', name }) },
      NetworkPolicy: { publicOnly: () => ({ type: 'publicOnly' }) },
    },
  };
}

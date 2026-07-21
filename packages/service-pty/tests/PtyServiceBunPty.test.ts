import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { PtyServiceBunPty } from '../src/PtyServiceBunPty';

const TENANT_A = tenant('org-a', 'account-a');
const TENANT_B = tenant('org-b', 'account-b');
const TENANT_A_OTHER_ACCOUNT = tenant('org-a', 'account-other');
const TENANT_A_STALE_PLACEMENT = Object.freeze({
  ...TENANT_A,
  placementEpoch: 2,
  requestId: 'org-a-stale-placement',
}) satisfies TTenantContext;

function tenant(orgId: string, accountId: string): TTenantContext {
  return Object.freeze({
    orgId,
    accountId,
    cellId: 'cell-local',
    placementEpoch: 1,
    roles: Object.freeze(['owner']),
    capabilities: Object.freeze(['pty']),
    requestId: `${orgId}-${accountId}-request`,
  });
}

function decodeChunks(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk)).join('');
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(25);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe('PtyServiceBunPty', () => {
  let tempRoot: string;
  let rootA: string;
  let rootB: string;
  let service: PtyServiceBunPty;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'vibecanvas-pty-service-'));
    rootA = join(tempRoot, 'org-a');
    rootB = join(tempRoot, 'org-b');
    mkdirSync(rootA);
    mkdirSync(rootB);
    rootA = realpathSync(rootA);
    rootB = realpathSync(rootB);

    const roots = new Map([
      [`${TENANT_A.orgId}:fs-local`, rootA],
      [`${TENANT_B.orgId}:fs-local`, rootB],
      [`${TENANT_A_OTHER_ACCOUNT.orgId}:fs-local`, rootA],
      [`${TENANT_A.orgId}:known-foreign`, rootA],
    ]);
    let nextClientId = 0;
    service = new PtyServiceBunPty({
      createSessionId: () => 'shared-session',
      createClientId: () => `client-${nextClientId += 1}`,
      resolveWorkingDirectory: (tenantContext, args) => {
        const root = roots.get(`${tenantContext.orgId}:${args.filesystemId}`);
        if (!root) return null;
        const candidate = resolve(isAbsolute(args.path) ? args.path : resolve(root, args.path));
        const fromRoot = relative(root, candidate);
        if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
        return candidate;
      },
    });
  });

  afterEach(async () => {
    await service.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('create/list/get/update/remove manages a tenant-scoped PTY session', async () => {
    const created = await service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      body: {
        command: '/bin/sh',
        title: 'Test Terminal',
        size: { rows: 30, cols: 120 },
      },
    });

    expect(created.title).toBe('Test Terminal');
    expect(created.command).toBe('/bin/sh');
    expect(created.cwd).toBe('');
    expect(created.cwd).not.toContain(tempRoot);
    expect(created.rows).toBe(30);
    expect(created.cols).toBe(120);
    expect(created.status).toBe('running');

    const listed = service.list(TENANT_A, { filesystemId: 'fs-local', workingDirectory: '.' });
    expect(listed.map((pty) => pty.id)).toEqual([created.id]);

    const fetched = service.get(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
    });
    expect(fetched?.title).toBe('Test Terminal');

    const updated = service.update(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
      body: {
        title: 'Renamed Terminal',
        size: { rows: 40, cols: 140 },
      },
    });
    expect(updated?.title).toBe('Renamed Terminal');
    expect(updated?.rows).toBe(40);
    expect(updated?.cols).toBe(140);

    expect(await service.remove(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
    })).toBe(true);
    expect(service.get(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
    })).toBeNull();
  });

  test('identical session IDs collide safely and foreign IDs do not leak existence', async () => {
    const createdA = await service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      body: { command: '/bin/sh', title: 'Tenant A' },
    });

    const foreign = service.get(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
    });
    const unknown = service.get(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: 'unknown-session',
    });
    expect(foreign).toBeNull();
    expect(unknown).toBeNull();
    expect(service.get(TENANT_A_OTHER_ACCOUNT, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
    })).toBeNull();
    expect(service.get(TENANT_A_STALE_PLACEMENT, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
    })).toBeNull();
    expect(service.update(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
      body: { title: 'Foreign rename' },
    })).toBeNull();
    expect(await service.remove(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
    })).toBe(false);
    expect(service.list(TENANT_B, { filesystemId: 'fs-local', workingDirectory: '.' })).toEqual([]);
    expect(service.get(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
    })?.title).toBe('Tenant A');

    const createdB = await service.create(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      body: { command: '/bin/sh', title: 'Tenant B' },
    });
    expect(createdB.id).toBe(createdA.id);
    expect(service.list(TENANT_A, { filesystemId: 'fs-local', workingDirectory: '.' })[0]?.title).toBe('Tenant A');
    expect(service.list(TENANT_B, { filesystemId: 'fs-local', workingDirectory: '.' })[0]?.title).toBe('Tenant B');

    const chunksA: Uint8Array[] = [];
    const chunksB: Uint8Array[] = [];
    const attachmentA = service.attach(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
      send: (data) => chunksA.push(new Uint8Array(data)),
    });
    const attachmentB = service.attach(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdB.id,
      send: (data) => chunksB.push(new Uint8Array(data)),
    });
    expect(attachmentA).not.toBeNull();
    expect(attachmentB).not.toBeNull();

    attachmentA!.send("printf 'only-tenant-a\\n'\n");
    attachmentB!.send("printf 'only-tenant-b\\n'\n");
    await waitFor(() => decodeChunks(chunksA).includes('only-tenant-a'));
    await waitFor(() => decodeChunks(chunksB).includes('only-tenant-b'));
    expect(decodeChunks(chunksA)).not.toContain('only-tenant-b');
    expect(decodeChunks(chunksB)).not.toContain('only-tenant-a');

    expect(await service.remove(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdA.id,
    })).toBe(true);
    expect(service.get(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: createdB.id,
    })?.title).toBe('Tenant B');

    attachmentA!.detach();
    attachmentB!.detach();
  });

  test('attach sends input and receives live output only for the owning tenant', async () => {
    const created = await service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      body: { command: '/bin/sh', title: 'Interactive Terminal' },
    });

    const chunks: Uint8Array[] = [];
    const attachment = service.attach(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
      cursor: 0,
      send: (data) => chunks.push(new Uint8Array(data)),
    });
    const foreignAttachment = service.attach(TENANT_B, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
      send: () => undefined,
    });

    expect(attachment).not.toBeNull();
    expect(foreignAttachment).toBeNull();
    attachment!.send("printf 'hello-from-pty\\n'\n");
    await waitFor(() => decodeChunks(chunks).includes('hello-from-pty'));
    attachment!.detach();
    attachment!.send("printf 'after-detach\\n'\n");
    await Bun.sleep(80);

    const replayedChunks: Uint8Array[] = [];
    const replay = service.attach(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
      cursor: 0,
      send: (data) => replayedChunks.push(new Uint8Array(data)),
    });
    expect(decodeChunks(replayedChunks)).toContain('hello-from-pty');
    expect(decodeChunks(replayedChunks)).not.toContain('after-detach');
    replay?.detach();
  });

  test('ctrl+c sent through the PTY interrupts the foreground process', async () => {
    const created = await service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      body: { command: '/bin/sh', title: 'Signal Terminal' },
    });

    const chunks: Uint8Array[] = [];
    const attachment = service.attach(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
      send: (data) => chunks.push(new Uint8Array(data)),
    });
    expect(attachment).not.toBeNull();

    attachment!.send("trap 'echo SIGINT_RECEIVED; exit 0' INT\n");
    attachment!.send('echo READY\n');
    attachment!.send('sleep 30\n');
    await waitFor(() => decodeChunks(chunks).includes('READY'));
    attachment!.send('\x03');
    await waitFor(() => decodeChunks(chunks).includes('SIGINT_RECEIVED'), 5000);
    attachment!.detach();
  });

  test('replays buffered output only through a tenant-scoped reconnect', async () => {
    const created = await service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      body: { command: '/bin/sh', title: 'Replay Terminal' },
    });

    const firstChunks: Uint8Array[] = [];
    const firstAttachment = service.attach(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
      cursor: 0,
      send: (data) => firstChunks.push(new Uint8Array(data)),
    });
    expect(firstAttachment).not.toBeNull();

    firstAttachment!.send("printf 'replay-check\\n'\n");
    await waitFor(() => decodeChunks(firstChunks).includes('replay-check'));
    firstAttachment!.detach();

    const replayedChunks: Uint8Array[] = [];
    const secondAttachment = service.attach(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
      ptyID: created.id,
      cursor: 0,
      send: (data) => replayedChunks.push(new Uint8Array(data)),
    });
    expect(secondAttachment).not.toBeNull();
    await waitFor(() => decodeChunks(replayedChunks).includes('replay-check'));
    secondAttachment!.detach();
  });

  test('rejects foreign filesystem authority and working-directory traversal identically', async () => {
    const foreignFilesystem = service.create(TENANT_B, {
      filesystemId: 'known-foreign',
      workingDirectory: '.',
      body: { command: '/bin/sh' },
    });
    const unknownFilesystem = service.create(TENANT_B, {
      filesystemId: 'unknown',
      workingDirectory: '.',
      body: { command: '/bin/sh' },
    });
    const traversal = service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '../org-b',
      body: { command: '/bin/sh' },
    });
    const absolute = service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: rootA,
      body: { command: '/bin/sh' },
    });
    const windowsAbsolute = service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: 'C:\\foreign',
      body: { command: '/bin/sh' },
    });

    await expect(foreignFilesystem).rejects.toThrow('PTY working directory not found');
    await expect(unknownFilesystem).rejects.toThrow('PTY working directory not found');
    await expect(traversal).rejects.toThrow('PTY working directory not found');
    await expect(absolute).rejects.toThrow('PTY working directory not found');
    await expect(windowsAbsolute).rejects.toThrow('PTY working directory not found');
  });

  test('rejects new PTY creation after stop', async () => {
    await service.stop();

    await expect(service.create(TENANT_A, {
      filesystemId: 'fs-local',
      workingDirectory: '.',
    })).rejects.toThrow('PTY service has been stopped');
  });
});

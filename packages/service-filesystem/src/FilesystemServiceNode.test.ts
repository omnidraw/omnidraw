import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { FilesystemServiceNode } from './FilesystemServiceNode';

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
    capabilities: Object.freeze(['filesystem']),
    requestId: `${orgId}-${accountId}-request`,
  });
}

async function nextEvent<T>(iterator: AsyncIterable<T>, timeoutMs = 3000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const result = await Promise.race([iterator[Symbol.asyncIterator]().next(), timeout])
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  if (result.done || result.value === undefined) throw new Error('Iterator finished unexpectedly');
  return result.value;
}

describe('FilesystemServiceNode', () => {
  let tempRoot: string;
  let rootA: string;
  let rootB: string;
  let service: FilesystemServiceNode;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'vibecanvas-filesystem-service-'));
    rootA = join(tempRoot, 'org-a');
    rootB = join(tempRoot, 'org-b');
    mkdirSync(rootA);
    mkdirSync(rootB);
    rootA = realpathSync(rootA);
    rootB = realpathSync(rootB);
    service = new FilesystemServiceNode(new EventPublisherService(), { watchTtlMs: 10_000 });
    service.registerRoot(TENANT_A, { filesystemId: 'fs-local', rootPath: rootA });
    service.registerRoot(TENANT_B, { filesystemId: 'fs-local', rootPath: rootB });
  });

  afterEach(() => {
    service.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('raw filesystem primitives stay inside the registered tenant root', () => {
    mkdirSync(join(rootA, 'source'));
    mkdirSync(join(rootA, 'destination'));

    const [writeResult, writeError] = service.writeFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'source/hello.txt',
      content: 'hello world',
    });
    expect(writeError).toBeNull();
    expect(writeResult).toBeUndefined();

    expect(service.homeDir(TENANT_A, { filesystemId: 'fs-local' })).toBe('');
    expect(service.resolveHostPath(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'source/hello.txt',
    })).toBe(join(rootA, 'source', 'hello.txt'));
    expect(service.exists(TENANT_A, { filesystemId: 'fs-local', path: 'source/hello.txt' })).toBe(true);

    const [entries, entriesError] = service.readdir(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'source',
    });
    expect(entriesError).toBeNull();
    expect(entries?.map((entry) => entry.name)).toEqual(['hello.txt']);

    const [stats, statsError] = service.stat(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'source/hello.txt',
    });
    expect(statsError).toBeNull();
    expect(stats?.isFile()).toBe(true);

    const [contents, contentsError] = service.readFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'source/hello.txt',
    });
    expect(contentsError).toBeNull();
    expect(contents?.toString('utf8')).toBe('hello world');

    const [renameResult, renameError] = service.rename(TENANT_A, {
      filesystemId: 'fs-local',
      sourcePath: 'source/hello.txt',
      targetPath: 'destination/hello.txt',
    });
    expect(renameError).toBeNull();
    expect(renameResult).toBeUndefined();
    expect(service.exists(TENANT_A, { filesystemId: 'fs-local', path: 'destination/hello.txt' })).toBe(true);
  });

  test('identical filesystem IDs resolve to independent organization roots', () => {
    writeFileSync(join(rootA, 'same.txt'), 'tenant A', 'utf8');
    writeFileSync(join(rootB, 'same.txt'), 'tenant B', 'utf8');

    const [contentsA, errorA] = service.readFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'same.txt',
    });
    const [contentsB, errorB] = service.readFile(TENANT_B, {
      filesystemId: 'fs-local',
      path: 'same.txt',
    });

    expect(errorA).toBeNull();
    expect(errorB).toBeNull();
    expect(contentsA?.toString('utf8')).toBe('tenant A');
    expect(contentsB?.toString('utf8')).toBe('tenant B');
  });

  test('known foreign and unknown filesystem IDs have identical not-found behavior', () => {
    service.registerRoot(TENANT_A, { filesystemId: 'known-foreign', rootPath: rootA });

    const [foreignContents, foreignError] = service.readFile(TENANT_B, {
      filesystemId: 'known-foreign',
      path: 'same.txt',
    });
    const [unknownContents, unknownError] = service.readFile(TENANT_B, {
      filesystemId: 'unknown',
      path: 'same.txt',
    });

    expect(foreignContents).toBeNull();
    expect(unknownContents).toBeNull();
    expect(foreignError).toEqual(unknownError);
    expect(service.homeDir(TENANT_B, { filesystemId: 'known-foreign' })).toBeNull();
    expect(service.homeDir(TENANT_B, { filesystemId: 'unknown' })).toBeNull();
    expect(service.homeDir(TENANT_A_STALE_PLACEMENT, { filesystemId: 'fs-local' })).toBeNull();
    expect(service.exists(TENANT_B, { filesystemId: 'known-foreign', path: '.' })).toBe(false);
    expect(service.exists(TENANT_B, { filesystemId: 'unknown', path: '.' })).toBe(false);

    const [, foreignListError] = service.readdir(TENANT_B, {
      filesystemId: 'known-foreign',
      path: '.',
    });
    const [, unknownListError] = service.readdir(TENANT_B, {
      filesystemId: 'unknown',
      path: '.',
    });
    const [, foreignWriteError] = service.writeFile(TENANT_B, {
      filesystemId: 'known-foreign',
      path: 'forbidden.txt',
      content: 'forbidden',
    });
    const [, unknownWriteError] = service.writeFile(TENANT_B, {
      filesystemId: 'unknown',
      path: 'forbidden.txt',
      content: 'forbidden',
    });
    expect(foreignListError).toEqual(unknownListError);
    expect(foreignWriteError).toEqual(unknownWriteError);
    expect(service.watch(TENANT_B, {
      filesystemId: 'known-foreign',
      path: '.',
      watchId: 'foreign-watch',
    })).toBeNull();
    expect(service.watch(TENANT_B, {
      filesystemId: 'unknown',
      path: '.',
      watchId: 'foreign-watch',
    })).toBeNull();
  });

  test('rejects lexical and symlink traversal outside the registered root', () => {
    writeFileSync(join(rootA, 'inside.txt'), 'org A', 'utf8');
    writeFileSync(join(rootB, 'secret.txt'), 'org B secret', 'utf8');
    symlinkSync(rootB, join(rootA, 'foreign-link'));

    const [, lexicalError] = service.readFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: '../org-b/secret.txt',
    });
    const [, symlinkError] = service.readFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'foreign-link/secret.txt',
    });
    const [, absoluteError] = service.readFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: join(rootA, 'inside.txt'),
    });
    const [, windowsAbsoluteError] = service.readFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: 'C:\\foreign\\secret.txt',
    });
    const [, writeError] = service.writeFile(TENANT_A, {
      filesystemId: 'fs-local',
      path: '../org-b/created.txt',
      content: 'forbidden',
    });
    const [, listError] = service.readdir(TENANT_A, {
      filesystemId: 'fs-local',
      path: '../org-b',
    });
    const [, moveError] = service.rename(TENANT_A, {
      filesystemId: 'fs-local',
      sourcePath: 'inside.txt',
      targetPath: '../org-b/moved.txt',
    });

    expect(lexicalError?.statusCode).toBe(403);
    expect(symlinkError?.statusCode).toBe(403);
    expect(absoluteError?.statusCode).toBe(403);
    expect(windowsAbsoluteError?.statusCode).toBe(403);
    expect(writeError?.statusCode).toBe(403);
    expect(listError?.statusCode).toBe(403);
    expect(moveError?.statusCode).toBe(403);
    expect(service.watch(TENANT_A, {
      filesystemId: 'fs-local',
      path: '../org-b',
      watchId: 'traversal-watch',
    })).toBeNull();
    expect(service.exists(TENANT_B, { filesystemId: 'fs-local', path: 'created.txt' })).toBe(false);
    expect(service.exists(TENANT_A, { filesystemId: 'fs-local', path: 'inside.txt' })).toBe(true);
  });

  test('watch IDs collide safely and events do not cross organizations', async () => {
    const iteratorA = service.watch(TENANT_A, {
      filesystemId: 'fs-local',
      path: '.',
      watchId: 'same-watch',
    });
    const iteratorB = service.watch(TENANT_B, {
      filesystemId: 'fs-local',
      path: '.',
      watchId: 'same-watch',
    });
    const iteratorOtherAccount = service.watch(TENANT_A_OTHER_ACCOUNT, {
      filesystemId: 'fs-local',
      path: '.',
      watchId: 'same-watch',
    });
    expect(iteratorA).not.toBeNull();
    expect(iteratorB).not.toBeNull();
    expect(iteratorOtherAccount).not.toBeNull();
    expect(service.watch(TENANT_A, {
      filesystemId: 'fs-local',
      path: '.',
      watchId: 'same-watch',
    })).toBeNull();

    const eventA = nextEvent(iteratorA!);
    const eventB = nextEvent(iteratorB!, 180).then(() => 'event', () => 'timeout');
    await Bun.sleep(20);
    writeFileSync(join(rootA, 'created.txt'), 'watch me', 'utf8');

    expect((await eventA).fileName).toBe('created.txt');
    expect(await eventB).toBe('timeout');
    expect(service.keepalive(TENANT_A, { filesystemId: 'fs-local', watchId: 'same-watch' })).toBe(true);
    expect(service.keepalive(TENANT_A_OTHER_ACCOUNT, { filesystemId: 'fs-local', watchId: 'same-watch' })).toBe(true);

    service.unwatch(TENANT_A, { filesystemId: 'fs-local', watchId: 'same-watch' });
    expect(service.keepalive(TENANT_A, { filesystemId: 'fs-local', watchId: 'same-watch' })).toBe(false);
    expect(service.keepalive(TENANT_A_OTHER_ACCOUNT, { filesystemId: 'fs-local', watchId: 'same-watch' })).toBe(true);
    expect(service.keepalive(TENANT_B, { filesystemId: 'fs-local', watchId: 'same-watch' })).toBe(true);
    service.unwatch(TENANT_A_OTHER_ACCOUNT, { filesystemId: 'fs-local', watchId: 'same-watch' });
  });

  test('stale watches expire and root revocation tears down remaining authority', async () => {
    service.stop();
    service = new FilesystemServiceNode(new EventPublisherService(), { watchTtlMs: 40 });
    service.registerRoot(TENANT_A, { filesystemId: 'fs-local', rootPath: rootA });

    const staleIterator = service.watch(TENANT_A, {
      filesystemId: 'fs-local',
      path: '.',
      watchId: 'stale-watch',
    });
    expect(staleIterator).not.toBeNull();
    const staleResult = staleIterator![Symbol.asyncIterator]().next();

    await Bun.sleep(120);
    expect(service.keepalive(TENANT_A, { filesystemId: 'fs-local', watchId: 'stale-watch' })).toBe(false);
    expect(await staleResult).toEqual({ done: true, value: undefined });

    const revokedIterator = service.watch(TENANT_A, {
      filesystemId: 'fs-local',
      path: '.',
      watchId: 'revoked-watch',
    });
    expect(revokedIterator).not.toBeNull();
    const revokedResult = revokedIterator![Symbol.asyncIterator]().next();
    service.unregisterRoot(TENANT_A, { filesystemId: 'fs-local' });
    expect(service.keepalive(TENANT_A, { filesystemId: 'fs-local', watchId: 'revoked-watch' })).toBe(false);
    expect(service.homeDir(TENANT_A, { filesystemId: 'fs-local' })).toBeNull();
    expect(await revokedResult).toEqual({ done: true, value: undefined });
  });
});

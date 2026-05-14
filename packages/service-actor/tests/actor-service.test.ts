import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ActorService, type TActorSandboxStartArgs } from '../src/index';
import { createActorTestDb } from './fixtures';

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe('ActorService', () => {
  test('implements runtime service lifecycle without starting sandbox when disabled', async () => {
    const { db, workflowDb, cleanup: cleanupDb } = await createActorTestDb();
    cleanup.push(cleanupDb);
    const service = new ActorService({ db, workflowDb, startSandbox: false, autoStart: false });

    await service.start();
    expect(service.name).toBe('serviceActor');
    expect(service.getStatus()).toEqual({
      sandboxStarted: false,
      workerStarted: false,
      supervisor: { polling: false, lastError: null },
    });
    await service.stop();
  });

  test('starts worker through sandbox runner and never executes guest code on host', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vibecanvas-actor-service-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const workerDistPath = join(root, 'worker.mjs');
    writeFileSync(workerDistPath, 'throw new Error("guest worker must only run inside sandbox")');
    const started: TActorSandboxStartArgs[] = [];
    let stopped = false;
    const { db, workflowDb, cleanup: cleanupDb } = await createActorTestDb();
    cleanup.push(cleanupDb);
    const service = new ActorService({
      db,
      workflowDb,
      workerDistPath,
      startSandbox: true,
      autoStart: false,
      sandboxRunner: {
        start: async (args) => {
          started.push(args);
          return { isHealthy: async () => true, stop: async () => { stopped = true; } };
        },
      },
    });

    await service.start();

    expect(started).toHaveLength(1);
    expect(started[0].workerDistPath).toBe(workerDistPath);
    expect(started[0].workerEnv.VIBECANVAS_WORKER_ID).toBe('actor-worker');
    expect(service.getStatus().sandboxStarted).toBe(true);

    await service.stop();
    expect(stopped).toBe(true);
  });
});

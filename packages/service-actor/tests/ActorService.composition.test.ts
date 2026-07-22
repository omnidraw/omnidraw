import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActorService } from '../src/ActorService';
import { ActorSupervisor } from '../src/ActorSupervisor';

const RETIRED_RESOURCE_FILES = [
  'src/resources/ActorResourceError.ts',
  'src/resources/ActorResourceKeyValuePersistence.ts',
  'src/resources/ActorResourceKeyValueStore.ts',
  'src/resources/ActorResourceManager.ts',
  'src/resources/DbResource.ts',
  'src/resources/DbResourceCoordinator.ts',
  'src/resources/KvResource.ts',
  'src/resources/SecretStoreKeyProvider.ts',
  'src/resources/SecretStoreResource.ts',
  'src/resources/fn.actor-resource-key-value.ts',
  'src/resources/fn.resource-data.ts',
  'src/resources/resource-types.ts',
] as const;

const EXPLICIT_EXPORTS = [
  '.',
  './Actor',
  './core/fn.normalize-actor-manifest',
  './core/types',
  './core/vibecanvasjson.zod',
  './icp-client',
  './legacy/resource-protocol',
] as const;

describe('ActorService managed composition boundary', () => {
  test('keeps stop cleanups registered when actor teardown fails and runs them after a successful retry', async () => {
    const configPath = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-stop-cleanup-'));
    const originalCloseActors = ActorSupervisor.prototype.closeActors;
    let cleanupCount = 0;
    let detachCount = 0;
    ActorSupervisor.prototype.closeActors = async () => {
      throw new Error('simulated actor teardown failure');
    };
    const service = new ActorService({
      db: {} as never,
      configPath,
      resourceService: {
        attachConsumer: () => () => { detachCount += 1; },
      } as never,
      eventPublisherService: {} as never,
    });
    service.addStopCleanup(() => { cleanupCount += 1; });

    try {
      await expect(service.stop()).rejects.toThrow('simulated actor teardown failure');
      expect(detachCount).toBe(1);
      expect(cleanupCount).toBe(0);

      ActorSupervisor.prototype.closeActors = originalCloseActors;
      await service.stop();
      expect(detachCount).toBe(1);
      expect(cleanupCount).toBe(1);
    } finally {
      ActorSupervisor.prototype.closeActors = originalCloseActors;
      await rm(configPath, { recursive: true, force: true });
    }
  });

  test('requires a neutral resource adapter and never constructs or owns providers', async () => {
    const source = await readFile(new URL('../src/ActorService.ts', import.meta.url), 'utf8');

    expect(source).toContain('resourceService: IActorResourceService;');
    expect(source).not.toContain('resourceService?: IActorResourceService');
    expect(source).not.toContain('claimResourceOwner');
    expect(source).not.toContain('ResourceOwnerLease');
    expect(source).not.toMatch(/from\s+['"]\.\/resources\/(?:ActorResourceManager|DbResource|DbResourceCoordinator)['"]/);
    expect(source).not.toMatch(/new\s+(?:ActorResourceManager|ActorResourceKeyValueStore|KvResource|SecretStoreResource|DbResource|DbResourceCoordinator)\b/);
    expect(source).not.toMatch(/#owned(?:ResourceManager|DbResourceCoordinator)\b/);
    expect(source).not.toMatch(/#legacyResource(?:Root|OwnerId|OwnerLease)\b/);
    expect(source).not.toMatch(/\b(?:dataRoot|resourceOwnerId|secretStoreKeyProvider|dbResourceDatabaseFactory|actorResourceKeyValueDatabaseFactory|actorResourceKeyValueMaxOpenHandles)\??:/);
    expect(source).toContain('return this.#resourceService.call(call)');
    expect(source).toContain('return this.#resourceService.getActorStartAdmission(args)');
    expect(source).not.toContain('transitionDefinitionPublication');
    expect(source).not.toContain('reloadDefinitionInstances');
    expect(source).not.toContain('#closeOwnedResources');
    expect(source).not.toContain('.reconcileStartup()');

    const removedResourceManagementMethods = [
      'listResources',
      'getResource',
      'createResource',
      'deleteResource',
      'bindResource',
      'replaceResourceBindings',
      'listResourceData',
      'setResourceDataEntry',
      'inspectDbResource',
      'createDbDraft',
      'confirmDbApply',
      'restoreDbBackup',
    ];
    for (const method of removedResourceManagementMethods) {
      expect(source).not.toMatch(new RegExp(`\\n  (?:async )?${method}\\(`));
      expect(source).not.toContain(`#resourceService.${method}`);
    }
  });

  test('removes actor-owned resource modules and exposes only explicit compatibility entries', async () => {
    for (const path of RETIRED_RESOURCE_FILES) {
      const details = await stat(new URL(`../${path}`, import.meta.url)).catch(() => null);
      expect(details, `${path} must stay retired`).toBeNull();
    }

    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, string> };
    expect(Object.keys(packageJson.exports).sort()).toEqual([...EXPLICIT_EXPORTS].sort());
    expect(packageJson.exports['./*']).toBeUndefined();

    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    const protocol = await readFile(new URL('../src/legacy/resource-protocol.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('ActorResourceError');
    expect(source).not.toContain('./resources/');
    expect(protocol).not.toContain('@vibecanvas/service-db');
    expect(protocol).not.toMatch(/\b(?:Provider|Persistence|Manager|Draft|Apply|Backup|Restore)\b/);
  });
});

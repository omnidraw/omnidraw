import { afterEach, describe, expect, test } from 'bun:test';
import { generateAutomergeUrl } from '@automerge/automerge-repo';
import { createRuntime } from '@vibecanvas/runtime';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import type { ActorService } from '@vibecanvas/service-actor';
import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ICliConfig } from '../src/config';
import { createCliHooks } from '../src/hooks';
import {
  LegacyActorPlugin,
  LegacyActorServicePool,
} from '../src/plugins/legacy-actor/LegacyActorPlugin';
import { handleHttpRequest } from '../src/plugins/server/http';
import { setupServices } from '../src/setup-services';

const roots: string[] = [];
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const tenant = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: DEFAULT_OSS_CELL_ID,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'legacy-actor-plugin-test',
});

function createConfig(root: string, legacyActorEnabled: boolean): ICliConfig {
  const home = fnResolveVibecanvasHome({ join, resolve }, {
    cwd: root,
    dataDir: root,
    env: {},
    homedir: root,
  });
  return {
    cwd: root,
    dev: true,
    compiled: false,
    legacyActorEnabled,
    version: '0.0.0-test',
    command: 'serve',
    rawArgv: ['bun', 'run'],
    argv: [],
    port: 0,
    home,
    helpRequested: false,
    versionRequested: false,
  };
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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LegacyActorPlugin composition', () => {
  test('boots normal v2 owners with no actor service or legacy process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-legacy-disabled-'));
    roots.push(root);
    const config = createConfig(root, false);
    const { services } = setupServices(config);
    const runtime = createRuntime({
      plugins: [],
      services,
      hooks: createCliHooks(),
      config,
    });

    await runtime.boot();
    try {
      expect(services.get('actor')).toBeUndefined();
      await expect(services.require('resource').listResources(tenant, {})).resolves.toEqual([]);
      expect((await services.require('widgetOwner').forTenant(tenant)).name).toBe('widget-service');
      expect((await services.require('agent').forTenant(tenant)).name).toBe('agent-service');
      expect(services.require('functionOwner').getTenantCount()).toBeGreaterThanOrEqual(1);

      const automerge = services.require('automerge');
      const document = await automerge.createDocument(tenant, {
        elements: {},
      });
      await services.require('db').canvas.create(tenant, {
        id: uuid(90),
        name: 'Legacy-disabled v2 collaboration',
        automerge_url: document.url,
      });
      await automerge.notifyDocumentRegistered(tenant, document.url);
      expect(automerge.getTenantMetrics(tenant).activeDocuments).toBe(1);
    } finally {
      await runtime.shutdown();
    }
    expect(services.get('actor')).toBeUndefined();
  });

  test('registers compatibility only when enabled and reports exact active child-process cost', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-legacy-enabled-'));
    roots.push(root);
    const config = createConfig(root, true);
    const plugin = new LegacyActorPlugin();
    const installedRoot = join(
      config.home.organizationsDir,
      tenant.orgId,
      'artifacts',
      'widgets',
      'legacy-plugin-widget',
    );
    await writeSource(installedRoot, {
      'vibecanvas.json': JSON.stringify({
        slug: 'legacy-plugin-widget',
        name: 'Legacy plugin widget',
        actor: {
          relFunctionPath: './actor/functions.ts',
          initialState: 'ready',
          initialData: {},
          states: { ready: { on: {} } },
          inputMsgSchema: {},
          outputMsgSchema: {},
        },
        widget: {
          relWidgetDir: './widget',
          frame: { width: 420, height: 300 },
          tool: {
            label: 'Legacy plugin widget',
            behavior: { type: 'mode', mode: 'draw-create' },
          },
        },
      }),
      'actor/functions.ts': 'export default { fn: {}, fx: {}, tx: {} };',
      'widget/main.ts': 'export default {};',
    });
    const { services } = setupServices(config, { legacyActor: plugin });
    const runtime = createRuntime({
      plugins: [plugin],
      services,
      hooks: createCliHooks(),
      config,
    });

    await runtime.boot();
    const actorPool = services.get('actor');
    if (!actorPool) throw new Error('Expected explicit legacy actor service registration.');
    const readHealth = async () => {
      const response = await handleHttpRequest(
        new Request('http://localhost/health'),
        config,
        services.require('db'),
        tenant,
        import.meta.dir,
        actorPool.diagnostics(),
      );
      return response.json() as Promise<{
        active_legacy_process_count: number;
      }>;
    };
    try {
      expect(actorPool.diagnostics()).toEqual({
        legacyActorEnabled: true,
        activeLegacyProcessCount: 0,
        activeLegacyTenantCount: 0,
      });
      expect((await readHealth()).active_legacy_process_count).toBe(0);
      const actorService = await actorPool.forTenant(tenant);
      expect(actorService.getVibecanvasJson('Legacy plugin widget')).toMatchObject({
        slug: 'legacy-plugin-widget',
      });
      expect(actorPool.diagnostics()).toMatchObject({
        activeLegacyProcessCount: 0,
        activeLegacyTenantCount: 1,
      });

      const agent = await services.require('agent').forTenant(tenant);
      const legacyEntry = (await agent.getWidgetCatalog([])).widgets.find(
        (entry) => entry.name === 'Legacy plugin widget',
      );
      const legacyReference = legacyEntry?.published?.placement?.reference;
      if (!legacyReference) throw new Error('Expected legacy placement reference.');
      await expect(agent.resolveWidgetPlacement(legacyReference)).resolves.toMatchObject({
        ok: true,
        descriptor: {
          kind: 'published-legacy',
          definitionName: 'Legacy plugin widget',
          definitionSlug: 'legacy-plugin-widget',
        },
      });

      const edit = await agent.startWidgetEditChat(
        'legacy-draft-widget',
        'legacy-draft-session',
        'Legacy plugin widget',
      );
      expect(edit.ok).toBe(true);
      const draftActor = await agent.startDraftActorChat(
        'legacy-draft-widget',
        'legacy-draft-session',
      );
      expect(draftActor.ready).toBe(true);
      expect(plugin.diagnostics().activeLegacyProcessCount).toBe(1);
      expect(actorPool.diagnostics().activeLegacyProcessCount).toBe(1);
      expect((await readHealth()).active_legacy_process_count).toBe(1);
      expect(await agent.stopDraftActorChat(
        'legacy-draft-widget',
        'legacy-draft-session',
      )).toEqual({ stopped: true });
      expect(plugin.diagnostics().activeLegacyProcessCount).toBe(0);
      expect(actorPool.diagnostics().activeLegacyProcessCount).toBe(0);
      expect((await readHealth()).active_legacy_process_count).toBe(0);

      const db = services.require('db');
      await db.canvas.create(tenant, {
        id: uuid(1),
        name: 'Legacy actor canvas',
        automerge_url: generateAutomergeUrl(),
      });
      const actor = await actorService.createInstance(
        'Legacy plugin widget',
        uuid(1),
        uuid(2),
      );
      expect(actor).not.toBeNull();
      expect(actorPool.diagnostics().activeLegacyProcessCount).toBe(1);
      await actorService.removeInstance(actor!.getId());
      expect(actorPool.diagnostics().activeLegacyProcessCount).toBe(0);

      const closingDraftActor = await agent.startDraftActorChat(
        'legacy-draft-widget',
        'legacy-draft-session',
      );
      expect(closingDraftActor.ready).toBe(true);
      expect(plugin.diagnostics().activeLegacyProcessCount).toBe(1);
      expect(actorPool.diagnostics().activeLegacyProcessCount).toBe(1);
    } finally {
      await runtime.shutdown();
    }
    expect(actorPool.diagnostics()).toEqual({
      legacyActorEnabled: true,
      activeLegacyProcessCount: 0,
      activeLegacyTenantCount: 0,
    });
    expect(plugin.diagnostics().activeLegacyProcessCount).toBe(0);
  });

  test('keeps ActorService construction and canvas callbacks out of default setup', async () => {
    const setupSource = await readFile(
      join(import.meta.dir, '../src/setup-services.ts'),
      'utf8',
    );
    const pluginSource = await readFile(
      join(import.meta.dir, '../src/plugins/legacy-actor/LegacyActorPlugin.ts'),
      'utf8',
    );

    expect(setupSource).not.toContain('@vibecanvas/service-actor');
    expect(setupSource).not.toContain('new ActorService');
    expect(setupSource).not.toContain('.createInstance(');
    expect(setupSource).not.toContain('.removeInstance(');
    expect(pluginSource).toContain("from '@vibecanvas/service-actor'");
    expect(pluginSource).toContain('new ActorService');
    expect(pluginSource).toContain('.createInstance(');
    expect(pluginSource).toContain('.removeInstance(');
  });
});

describe('LegacyActorServicePool organization placement ownership', () => {
  test('reuses exactly one legacy owner across accounts in the same organization placement', async () => {
    let createCount = 0;
    const pool = new LegacyActorServicePool({
      create: async (placement) => {
        createCount += 1;
        return {
          accountIdAtCreation: placement.accountId,
          start: async () => {},
          stop: async () => {},
        } as unknown as ActorService;
      },
    }, new Set(), new Set());
    pool.start({ hooks: {}, config: {} });

    try {
      const accountA = fnFreezeTenantContext({
        ...tenant,
        accountId: uuid(101),
        requestId: 'legacy-pool-account-a',
      });
      const accountB = fnFreezeTenantContext({
        ...tenant,
        accountId: uuid(102),
        requestId: 'legacy-pool-account-b',
      });
      const first = await pool.forTenant(accountA);
      const second = await pool.forTenant(accountB);

      expect(second).toBe(first);
      expect(createCount).toBe(1);
      expect(pool.getTenantCount()).toBe(1);
    } finally {
      await pool.stop();
    }
  });

  test('retires the old organization owner before starting a higher placement epoch', async () => {
    const events: string[] = [];
    const pool = new LegacyActorServicePool({
      create: async (placement) => ({
        placementEpoch: placement.placementEpoch,
        start: async () => { events.push(`start:${placement.placementEpoch}`); },
        stop: async () => { events.push(`stop:${placement.placementEpoch}`); },
      } as unknown as ActorService),
    }, new Set(), new Set());
    pool.start({ hooks: {}, config: {} });

    const original = fnFreezeTenantContext({
      ...tenant,
      cellId: uuid(201),
      requestId: 'legacy-pool-placement-1',
    });
    const replacement = fnFreezeTenantContext({
      ...original,
      cellId: uuid(202),
      placementEpoch: original.placementEpoch + 1,
      requestId: 'legacy-pool-placement-2',
    });

    try {
      await expect(pool.forTenant(original)).resolves.toMatchObject({ placementEpoch: 1 });
      await expect(pool.forTenant(replacement)).resolves.toMatchObject({ placementEpoch: 2 });

      expect(events).toEqual(['start:1', 'stop:1', 'start:2']);
      expect(pool.getTenantCount()).toBe(1);
      await expect(pool.forTenant(original)).rejects.toThrow(
        'rejected stale organization placement epoch 1; current epoch is 2',
      );
    } finally {
      await pool.stop();
    }
    expect(events).toEqual(['start:1', 'stop:1', 'start:2', 'stop:2']);
  });
});

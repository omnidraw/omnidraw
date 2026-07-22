import { afterEach, describe, expect, test } from 'bun:test';
import { BunChildSandboxDriver } from '@vibecanvas/function-runtime/local';
import { createRuntime } from '@vibecanvas/runtime';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import type { TCanvasDoc, TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import type { TWidgetManifestV2 } from '@vibecanvas/widget-contract';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ICliConfig } from '../src/config';
import { createCliHooks } from '../src/hooks';
import { setupServices } from '../src/setup-services';

const roots: string[] = [];
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

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

async function waitFor<T>(
  read: () => Promise<T>,
  complete: (value: T) => boolean,
  message: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = await read();
    if (complete(value)) return value;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  }
}

async function directoryEntries(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function createConfig(root: string): ICliConfig {
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

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

class ObservedBunChildSandboxDriver extends BunChildSandboxDriver {
  readonly observedStarts: Array<Readonly<{
    pid: number;
    processGroupExists: boolean;
    rssBytes: number;
  }>> = [];

  override async start(...args: Parameters<BunChildSandboxDriver['start']>) {
    const handle = await super.start(...args);
    const diagnostics = this.diagnostics();
    const pid = diagnostics.activeGuestPids[0];
    if (
      diagnostics.activeGuestCount !== 1
      || pid === undefined
      || diagnostics.activeGuestProcessGroupIds[0] !== pid
    ) {
      throw new Error('Started function sandbox did not expose exactly one guest process group.');
    }
    this.observedStarts.push(Object.freeze({
      pid,
      processGroupExists: processGroupExists(pid),
      rssBytes: diagnostics.activeGuestRssBytes,
    }));
    return handle;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('managed widget joined production flow', () => {
  test('joins resource persistence, Automerge projection, publication, and invocation with zero residue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-managed-v2-joined-'));
    roots.push(root);
    const config = createConfig(root);
    const tenant = fnFreezeTenantContext({
      orgId: DEFAULT_OSS_ORGANIZATION_ID,
      accountId: DEFAULT_OSS_ACCOUNT_ID,
      cellId: DEFAULT_OSS_CELL_ID,
      placementEpoch: 1,
      roles: ['owner'],
      capabilities: ['*'],
      requestId: 'managed-v2-joined-flow',
      canvasId: uuid(990),
    });
    let functionSandboxDriver: ObservedBunChildSandboxDriver | null = null;
    const { services, dbService } = setupServices(config, {
      createFunctionSandboxDriver: (driverConfig) => {
        const driver = new ObservedBunChildSandboxDriver(driverConfig);
        functionSandboxDriver = driver;
        return driver;
      },
    });
    if (!dbService) throw new Error('Expected stateful serve composition.');
    const runtime = createRuntime({
      plugins: [],
      services,
      hooks: createCliHooks(),
      config,
    });

    await runtime.boot();
    try {
      const resourceOwner = await services.require('resourceOwner').forTenant(tenant);
      const resource = await resourceOwner.createResource(tenant, {
        kind: 'kv',
        name: 'Joined-flow results',
      });
      expect(resource).toMatchObject({ kind: 'kv', status: 'ready' });

      const sourceRoot = join(root, 'joined-widget-source');
      await writeSource(sourceRoot, {
        'ui/main.ts': [
          'import { persistResult } from "../server/persist.server";',
          'export const save = (key: string, value: string) => persistResult({ key, value });',
        ].join('\n'),
        'server/index.ts': 'import "./persist.server";',
        'server/persist.server.ts': [
          'import { defineServerFunction } from "@vibecanvas/sdk/server";',
          'import { z } from "zod";',
          'const Input = z.object({ key: z.string(), value: z.string() });',
          'const Output = z.object({ value: z.string(), revision: z.number().int() });',
          'export const persistResult = defineServerFunction({',
          '  effect: "tx", input: Input, output: Output, resources: { results: "write" },',
          '  limits: { timeoutMs: 5000, memoryTier: "small", outputByteLimit: 4096, logByteLimit: 4096 },',
          '}, async (context, input) => {',
          '  return context.resources.write("results", "set", { key: input.key, value: input.value });',
          '});',
        ].join('\n'),
      });
      const widget = await services.require('widgetOwner').forTenant(tenant);
      const snapshot = await widget.captureSource(tenant, sourceRoot, {
        id: uuid(991),
        createdAtMs: 10,
      });
      const manifest: TWidgetManifestV2 = {
        schemaVersion: 2,
        name: 'Managed v2 joined flow',
        slug: 'managed-v2-joined-flow',
        ui: { entry: 'ui/main.ts' },
        server: { entry: 'server/index.ts', runtimeAbi: 'vibecanvas-function-v1' },
        resources: [{ slot: 'results', kind: 'kv', effect: 'write', required: true }],
      };
      const published = await widget.publish(tenant, {
        definitionId: uuid(992),
        revisionId: uuid(993),
        expectedActiveRevisionId: null,
        snapshot,
        manifest,
        bindings: [{
          slot: 'results',
          resourceId: resource.id,
          kind: 'kv',
          allowRead: false,
          allowWrite: true,
        }],
        builderIdentity: `vibecanvas-widget-bun/${Bun.version}`,
        nowMs: 20,
      });
      if (published.status !== 'committed') throw new Error('Expected immutable publication to commit.');
      expect(published.revision).toMatchObject({
        id: uuid(993),
        revisionNumber: 1,
        manifest: { schemaVersion: 2 },
        functionDescriptors: [{
          exportName: 'persistResult',
          effect: 'tx',
          resources: [{ slot: 'results', effect: 'write' }],
        }],
      });
      await expect(widget.getActiveRevision(tenant, published.definition.id))
        .resolves.toEqual(published.revision);

      const automerge = services.require('automerge');
      const document = await automerge.createDocument<TCanvasDoc>(tenant, {
        id: tenant.canvasId!,
        name: 'Managed v2 joined canvas',
        elements: {},
        groups: {},
      });
      await dbService.canvas.create(tenant, {
        id: tenant.canvasId!,
        name: 'Managed v2 joined canvas',
        automerge_url: document.url,
      });
      await automerge.notifyDocumentRegistered(tenant, document.url);
      const element: TElement = {
        id: 'managed-v2-joined-element',
        x: 10,
        y: 20,
        rotation: 0,
        zIndex: '',
        parentGroupId: null,
        bindings: [],
        locked: false,
        createdAt: 30,
        updatedAt: 30,
        data: {
          type: 'widget-instance',
          definitionId: published.definition.id,
          revisionId: published.revision.id,
          instanceId: uuid(994),
          expanded: true,
          window: 'contained',
          h: 320,
          w: 360,
        },
        style: {},
      };
      document.change((draft) => {
        draft.elements[element.id] = element;
      });
      const projected = await waitFor(
        async () => (await dbService.db.prepare(`
          SELECT canvas_id, definition_id, revision_id, status
          FROM widget_instances
          WHERE org_id = ? AND id = ?
        `)).get(tenant.orgId, uuid(994)),
        (value) => value !== null && value !== undefined,
        'Timed out waiting for the durable Automerge widget projection.',
      );
      expect(projected).toEqual({
        canvas_id: tenant.canvasId,
        definition_id: published.definition.id,
        revision_id: published.revision.id,
        status: 'active',
      });
      expect(automerge.getTenantMetrics(tenant).activeDocuments).toBe(1);

      const functionInvocation = services.require('functionInvocation');
      const accepted = await functionInvocation.invokeFunction(tenant, {
        widgetInstanceId: uuid(994),
        functionName: 'persistResult',
        input: { key: 'joined/result', value: 'persisted-through-v2' },
        idempotencyKey: 'managed-v2-joined-flow-key',
      });
      const terminal = await waitFor(
        () => functionInvocation.getFunctionInvocation(tenant, accepted.id),
        (value) => value !== null && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(value.status),
        'Timed out waiting for the joined-flow function invocation.',
      );
      expect(terminal).toMatchObject({
        id: accepted.id,
        widgetRevisionId: published.revision.id,
        widgetInstanceId: uuid(994),
        status: 'succeeded',
        output: { value: 'persisted-through-v2', revision: 1 },
        failure: null,
      });
      await expect(resourceOwner.getResourceDataEntry(tenant, {
        resourceId: resource.id,
        key: 'joined/result',
      })).resolves.toMatchObject({
        kind: 'kv',
        key: 'joined/result',
        value: 'persisted-through-v2',
        revision: 1,
      });

      const durableEvidence = await (await dbService.db.prepare(`
        SELECT
          (SELECT count(*) FROM widget_definition_revisions WHERE org_id = ?) AS revision_count,
          (SELECT count(*) FROM artifact_references WHERE org_id = ?) AS artifact_count,
          (SELECT count(*) FROM function_attempts WHERE org_id = ? AND status = 'succeeded') AS succeeded_attempt_count,
          (SELECT count(*) FROM resource_write_permits WHERE org_id = ? AND status = 'consumed') AS consumed_permit_count,
          (SELECT count(*) FROM invocation_leases WHERE org_id = ?) AS active_lease_count,
          (SELECT content_version FROM collaboration_documents WHERE org_id = ? AND canvas_id = ?) AS automerge_content_version,
          (SELECT count(*) FROM collaboration_chunks WHERE org_id = ? AND document_id = ?) AS automerge_chunk_count
      `)).get(
        tenant.orgId,
        tenant.orgId,
        tenant.orgId,
        tenant.orgId,
        tenant.orgId,
        tenant.orgId,
        tenant.canvasId!,
        tenant.orgId,
        tenant.canvasId!,
      ) as Record<string, unknown>;
      const numericEvidence = Object.fromEntries(
        Object.entries(durableEvidence).map(([key, value]) => [key, Number(value)]),
      );
      expect(numericEvidence).toMatchObject({
        revision_count: 1,
        artifact_count: 3,
        succeeded_attempt_count: 1,
        consumed_permit_count: 1,
        active_lease_count: 0,
      });
      expect(numericEvidence.automerge_content_version).toBeGreaterThan(0);
      expect(numericEvidence.automerge_chunk_count).toBeGreaterThan(0);

      if (functionSandboxDriver === null) throw new Error('Function sandbox driver was not constructed.');
      expect(functionSandboxDriver.observedStarts).toHaveLength(1);
      const observedStart = functionSandboxDriver.observedStarts[0]!;
      expect(observedStart.processGroupExists).toBe(true);
      expect(observedStart.rssBytes).toBeGreaterThanOrEqual(0);
      expect(functionSandboxDriver.diagnostics()).toEqual({
        warmTtlMs: 0,
        preparedInvocationCount: 0,
        activeGuestCount: 0,
        activeGuestPids: [],
        activeGuestProcessGroupIds: [],
        activeGuestRssBytes: 0,
        teardownFailures: [],
      });
      expect(processGroupExists(observedStart.pid)).toBe(false);
      expect(await directoryEntries(join(
        config.home.organizationsDir,
        tenant.orgId,
        'temp',
        'function-runtime',
      ))).toEqual([]);
    } finally {
      await runtime.shutdown();
    }

  }, 60_000);
});

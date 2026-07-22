import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import type { TWidgetManifestV2 } from '@vibecanvas/widget-contract';
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const roots: string[] = [];

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
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = await read();
    if (complete(value)) return value;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for function completion.');
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('production short-lived function composition', () => {
  test('publishes, invokes, persists, and tears down one exact server revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-function-composition-'));
    roots.push(root);
    const home = fnResolveVibecanvasHome({ join, resolve }, {
      cwd: root,
      dataDir: root,
      env: {},
      homedir: root,
    });
    const config: ICliConfig = {
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
    const tenant = fnFreezeTenantContext({
      orgId: DEFAULT_OSS_ORGANIZATION_ID,
      accountId: DEFAULT_OSS_ACCOUNT_ID,
      cellId: DEFAULT_OSS_CELL_ID,
      placementEpoch: 1,
      roles: ['owner'],
      capabilities: ['*'],
      requestId: 'function-composition-request',
      canvasId: uuid(962),
    });
    const wsTenant = fnFreezeTenantContext({
      orgId: tenant.orgId,
      accountId: tenant.accountId,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      roles: tenant.roles,
      capabilities: tenant.capabilities,
      requestId: 'function-composition-websocket-request',
    });
    const outsiderTenant = fnFreezeTenantContext({
      orgId: tenant.orgId,
      accountId: uuid(967),
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      roles: ['member'],
      capabilities: [],
      requestId: 'function-composition-outsider-request',
    });
    const { services, dbService } = setupServices(config);
    const context = { config: {}, hooks: {} };
    const widgetOwner = services.require('widgetOwner');
    const resourceOwner = services.require('resourceOwner');
    const functionOwner = services.require('functionOwner');
    const functionInvocation = services.require('functionInvocation');

    await dbService.start();
    widgetOwner.start(context);
    resourceOwner.start(context);
    await functionOwner.start(context);
    expect(functionOwner.getTenantCount()).toBe(1);
    try {
      const sourceRoot = join(root, 'source');
      await writeSource(sourceRoot, {
        'ui/main.ts': [
          'import { echo } from "../server/echo.server";',
          'export const invokeEcho = (value: string) => echo({ value });',
        ].join('\n'),
        'server/index.ts': 'import "./echo.server";',
        'server/echo.server.ts': [
          'import { defineServerFunction } from "@vibecanvas/sdk/server";',
          'import { z } from "zod";',
          'const Shape = z.object({ value: z.string() });',
          'export const echo = defineServerFunction({',
          '  effect: "fn", input: Shape, output: Shape,',
          '  limits: { timeoutMs: 1000, memoryTier: "small", outputByteLimit: 4096, logByteLimit: 4096 },',
          '}, async (_ctx, input) => ({ value: `echo:${input.value}` }));',
        ].join('\n'),
      });
      const widget = await widgetOwner.forTenant(tenant);
      const snapshot = await widget.captureSource(tenant, sourceRoot, {
        id: uuid(963),
        createdAtMs: 10,
      });
      const manifest: TWidgetManifestV2 = {
        schemaVersion: 2,
        name: 'Function composition',
        slug: 'function-composition',
        ui: { entry: 'ui/main.ts' },
        server: { entry: 'server/index.ts', runtimeAbi: 'vibecanvas:test-1' },
      };
      const published = await widget.publish(tenant, {
        definitionId: uuid(964),
        revisionId: uuid(965),
        expectedActiveRevisionId: null,
        snapshot,
        manifest,
        bindings: [],
        builderIdentity: `vibecanvas-widget-bun/${Bun.version}`,
        nowMs: 20,
      });
      if (published.status !== 'committed') throw new Error('Expected function publication to commit.');
      expect(published.revision.functionDescriptors).toEqual([
        expect.objectContaining({ exportName: 'echo', modulePath: 'server/echo.server.ts' }),
      ]);

      await (await dbService.db.prepare(`
        INSERT INTO canvases (
          org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 'Function canvas', 'org', ?, 30, 30)
      `)).run(tenant.orgId, tenant.canvasId!, tenant.accountId);
      await (await dbService.db.prepare(`
        INSERT INTO canvas_members (
          org_id, canvas_id, account_id, role, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, 'owner', 30, 30)
      `)).run(tenant.orgId, tenant.canvasId!, tenant.accountId);
      await (await dbService.db.prepare(`
        INSERT INTO accounts (
          id, kind, display_name, status, is_autogenerated, created_at_ms, updated_at_ms
        ) VALUES (?, 'user', 'Function outsider', 'active', 0, 30, 30)
      `)).run(outsiderTenant.accountId);
      await (await dbService.db.prepare(`
        INSERT INTO organization_memberships (
          org_id, account_id, role, status, is_billable_seat, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 'member', 'active', 1, 30, 30)
      `)).run(tenant.orgId, outsiderTenant.accountId);
      await (await dbService.db.prepare(`
        INSERT INTO widget_instances (
          org_id, id, canvas_id, element_id, definition_id, revision_id,
          status, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, 'function-element', ?, ?, 'active', 31, 31)
      `)).run(
        tenant.orgId,
        uuid(966),
        tenant.canvasId!,
        published.definition.id,
        published.revision.id,
      );

      await expect(functionInvocation.invokeFunction(outsiderTenant, {
        widgetInstanceId: uuid(966),
        functionName: 'echo',
        input: { value: 'unauthorized' },
        idempotencyKey: 'function-composition-outsider-key',
      })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_NOT_FOUND' });

      const accepted = await functionInvocation.invokeFunction(wsTenant, {
        widgetInstanceId: uuid(966),
        functionName: 'echo',
        input: { value: 'hello' },
        idempotencyKey: 'function-composition-stable-key',
      });
      await expect(functionInvocation.getFunctionInvocation(
        outsiderTenant,
        accepted.id,
      )).resolves.toBeNull();
      await expect(functionInvocation.cancelFunctionInvocation(
        outsiderTenant,
        accepted.id,
      )).resolves.toBeNull();
      const terminal = await waitFor(
        () => functionInvocation.getFunctionInvocation(wsTenant, accepted.id),
        (value) => value !== null && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(value.status),
      );
      expect(terminal).toMatchObject({
        id: accepted.id,
        functionName: 'echo',
        widgetRevisionId: published.revision.id,
        widgetInstanceId: uuid(966),
        status: 'succeeded',
        output: { value: 'echo:hello' },
        failure: null,
      });
      const attempt = await (await dbService.db.prepare(`
        SELECT status, cold_start, billable
        FROM function_attempts
        WHERE org_id = ? AND invocation_id = ?
      `)).get(tenant.orgId, accepted.id);
      expect(attempt).toEqual({ status: 'succeeded', cold_start: 1, billable: 1 });
      const usage = await (await dbService.db.prepare(`
        SELECT count(*) AS count FROM usage_outbox
        WHERE org_id = ? AND attempt_id IS NOT NULL
      `)).get(tenant.orgId) as { count: unknown };
      expect(Number(usage.count)).toBe(1);
    } finally {
      await functionOwner.stop();
      await resourceOwner.stop();
      await widgetOwner.stop();
      await dbService.stop();
    }
  }, 30_000);
});

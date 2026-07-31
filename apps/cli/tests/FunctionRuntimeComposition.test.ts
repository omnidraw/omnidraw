import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CANVAS_WIDGET_EXTENSION_KEY } from '@omnidraw/canvas-contract';
import { buildCapsuleGuest } from '@omnidraw/capsule-omnidraw/build';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@omnidraw/service-db/CONSTANTS';
import { AgentAuthoringStoreTurso } from '@omnidraw/service-db/AgentAuthoringStoreTurso';
import { WidgetControlStoreTurso } from '@omnidraw/service-db/WidgetControlStoreTurso';
import { fnResolveOmnidrawHome } from '@omnidraw/shared-functions/omnidraw-config/fn.resolve-omnidraw-home';
import { fnFreezeTenantContext } from '@omnidraw/tenant-core';
import type { TWidgetManifestV3 } from '@omnidraw/widget-contract';
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';
import { fnWidgetCapsuleBuilderIdentity } from '../src/services/fn.widget-capsule-builder-identity';
import {
  CAPSULE_PUBLICATION_IDENTITY,
  capsuleUi,
  testWidgetDistributionBuild,
} from './widget-capsule.fixture';

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
  test('executes exact published and durable Preview server revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-function-composition-'));
    roots.push(root);
    const home = fnResolveOmnidrawHome({ join, resolve }, {
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
    const { services, dbService } = setupServices(config, {
      capsuleBuild: buildCapsuleGuest,
      distributionBuild: testWidgetDistributionBuild,
    });
    const context = { config: {}, hooks: {} };
    const widgetOwner = services.require('widgetOwner');
    const resourceOwner = services.require('resourceOwner');
    const functionOwner = services.require('functionOwner');
    const functionInvocation = services.require('functionInvocation');
    const canvasService = services.require('canvas');

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
          'import { defineServerFunction } from "@omnidraw/sdk/server";',
          'import { z } from "zod";',
          'const Shape = z.object({ value: z.string() });',
          'export const echo = defineServerFunction({',
          '  effect: "fn", input: Shape, output: Shape,',
          '  limits: { timeoutMs: 5000, memoryTier: "small", outputByteLimit: 4096, logByteLimit: 4096 },',
          '}, async (_ctx, input) => ({ value: `echo:${input.value}` }));',
        ].join('\n'),
      });
      const widget = await widgetOwner.forTenant(tenant);
      const snapshot = await widget.captureSource(tenant, sourceRoot, {
        id: uuid(963),
        createdAtMs: 10,
      });
      const manifest: TWidgetManifestV3 = {
        schemaVersion: 3,
        name: 'Function composition',
        slug: 'function-composition',
        ui: capsuleUi('ui/main.ts'),
        server: { entry: 'server/index.ts', runtimeAbi: 'omnidraw:test-1' },
      };
      const published = await widget.publish(tenant, {
        definitionId: uuid(964),
        revisionId: uuid(965),
        expectedActiveRevisionId: null,
        snapshot,
        manifest,
        bindings: [],
        builderIdentity: fnWidgetCapsuleBuilderIdentity({
          npmVersion: 'external',
          serverBunVersion: Bun.version,
        }),
        ...CAPSULE_PUBLICATION_IDENTITY,
        nowMs: 20,
      });
      if (published.status !== 'committed') throw new Error('Expected function publication to commit.');
      expect(published.revision.functionDescriptors).toEqual([
        expect.objectContaining({ exportName: 'echo', modulePath: 'server/echo.server.ts' }),
      ]);

      await dbService.canvas.create(tenant, {
        id: tenant.canvasId!,
        name: 'Function canvas',
      });
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
      const inserted = await canvasService.execute(tenant, {
        commandId: uuid(968),
        canvasId: tenant.canvasId!,
        baseRevision: 0,
        operations: [{
          type: 'insert',
          item: {
            id: 'function-element',
            kind: 'widget-frame',
            parentId: null,
            orderKey: 'a0',
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 1, y: 1 },
              skew: { x: 0, y: 0 },
              origin: { x: 0, y: 0 },
            },
            size: { width: 320, height: 240 },
            extensions: {
              [CANVAS_WIDGET_EXTENSION_KEY]: {
                schemaVersion: 1,
                type: 'widget-instance',
                instanceId: uuid(966),
                definitionId: published.definition.id,
                revisionId: published.revision.id,
              },
            },
          },
        }],
        preconditions: [{
          type: 'item-absent',
          itemId: 'function-element',
        }],
      });
      expect(inserted.revision).toBe(1);

      await expect(functionInvocation.invokeFunction(outsiderTenant, {
        widgetInstanceId: uuid(966),
        widgetRevisionId: published.revision.id,
        functionName: 'echo',
        input: { value: 'unauthorized' },
        idempotencyKey: 'function-composition-outsider-key',
      })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_NOT_FOUND' });

      const accepted = await functionInvocation.invokeFunction(wsTenant, {
        widgetInstanceId: uuid(966),
        widgetRevisionId: published.revision.id,
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

      const previewChatId = uuid(970);
      const previewDraftId = uuid(971);
      const previewId = uuid(972);
      const previewRevisionId = uuid(973);
      const previewCommittedMutationId = 'mutation-function-composition-preview';
      const authoringStore = new AgentAuthoringStoreTurso(
        dbService.db,
        new WidgetControlStoreTurso(dbService.db),
      );
      await authoringStore.createChat(tenant, {
        id: previewChatId,
        canvasId: tenant.canvasId!,
        externalSessionKey: 'function-composition-preview-chat',
        name: 'Function composition Preview',
        workspaceRelativePath: 'chats/function-composition-preview',
        historyRelativePath: 'history/function-composition-preview.jsonl',
        nowMs: 40,
      });
      await authoringStore.createDraft(tenant, {
        id: previewDraftId,
        chatId: previewChatId,
        definitionId: published.definition.id,
        name: 'Function composition Preview draft',
        sourceRelativePath: 'drafts/function-composition-preview',
        nowMs: 41,
      });
      await authoringStore.ensurePreviewOwner(tenant, {
        id: previewId,
        canvasId: tenant.canvasId!,
        frameNodeId: 'function-composition-preview-frame',
        draftId: previewDraftId,
        originChatId: previewChatId,
        role: 'placed',
        nowMs: 42,
      });
      await (await dbService.db.prepare(`
        INSERT INTO canvas_items (
          org_id, canvas_id, id, item_json, item_revision,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, 0, 42, 42)
      `)).run(
        tenant.orgId,
        tenant.canvasId!,
        'function-composition-preview-frame',
        JSON.stringify({
          id: 'function-composition-preview-frame',
          kind: 'widget-frame',
          parentId: null,
          orderKey: 'preview-frame',
          extensions: {
            [CANVAS_WIDGET_EXTENSION_KEY]: {
              schemaVersion: 1,
              type: 'ui-widget',
              kind: 'preview',
              payload: {
                previewId,
                draftId: previewDraftId,
                originChatId: previewChatId,
                role: 'placed',
              },
            },
          },
        }),
      );
      await expect(authoringStore.compareAndSetDraft(tenant, {
        draftId: previewDraftId,
        expectedSourceDigestSha256: null,
        nextSourceDigestSha256: snapshot.digestSha256,
        expectedCommittedMutationId: null,
        nextCommittedMutationId: previewCommittedMutationId,
        expectedBuildSequence: 0,
        nextBuildSequence: 1,
        nextStatus: 'ready',
        lastError: null,
        nowMs: 43,
      })).resolves.toMatchObject({ status: 'updated' });
      await expect(authoringStore.compareAndSetPreviewOwner(tenant, {
        previewId,
        expectedBuildSequence: 0,
        nextBuildSequence: 1,
        status: 'building',
        activeRevisionId: null,
        pendingBuildId: previewRevisionId,
        lastError: null,
        expectedBindingRevision: 0,
        nextBindingRevision: 0,
        expectedBindingPlanDigestSha256: null,
        nextBindingPlanDigestSha256:
          createHash('sha256').update('[]').digest('hex'),
        expectedSourceDigestSha256: null,
        nextSourceDigestSha256: snapshot.digestSha256,
        expectedCommittedMutationId: null,
        nextCommittedMutationId: previewCommittedMutationId,
        nowMs: 44,
      })).resolves.toMatchObject({ status: 'building' });
      const preview = await widgetOwner.buildPreview(tenant, {
        previewId,
        previewRevisionId,
        expectedActiveRevisionId: null,
        buildSequence: 1,
        bindingRevision: 0,
        draftId: previewDraftId,
        definitionId: published.definition.id,
        draftRevisionSha256: snapshot.digestSha256,
        committedMutationId: previewCommittedMutationId,
        snapshot,
        manifest,
        bindings: [],
        builderIdentity: fnWidgetCapsuleBuilderIdentity({
          npmVersion: 'external',
          serverBunVersion: Bun.version,
        }),
        ...CAPSULE_PUBLICATION_IDENTITY,
        nowMs: 45,
      });
      expect(preview.functionDescriptors).toEqual([
        expect.objectContaining({ exportName: 'echo' }),
      ]);
      const previewMountLeaseId = uuid(976);
      const previewMountLeaseNowMs = Date.now();
      await expect(authoringStore.acquirePreviewMountLease(tenant, {
        leaseId: previewMountLeaseId,
        previewId,
        previewRevisionId,
        canvasId: tenant.canvasId!,
        frameNodeId: 'function-composition-preview-frame',
        nowMs: previewMountLeaseNowMs,
        ttlMs: 60_000,
      })).resolves.toMatchObject({
        leaseId: previewMountLeaseId,
        previewId,
        previewRevisionId,
      });

      const previewAccepted = await functionInvocation.invokeFunction(wsTenant, {
        widgetInstanceId: previewId,
        widgetRevisionId: previewRevisionId,
        functionName: 'echo',
        input: { value: 'preview' },
        idempotencyKey: 'function-composition-preview-key',
      });
      const previewTerminal = await waitFor(
        () => functionInvocation.getFunctionInvocation(wsTenant, previewAccepted.id),
        (value) => value !== null
          && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(value.status),
      );
      expect(previewTerminal).toMatchObject({
        id: previewAccepted.id,
        functionName: 'echo',
        widgetRevisionId: previewRevisionId,
        widgetInstanceId: previewId,
        status: 'succeeded',
        output: { value: 'echo:preview' },
        failure: null,
      });
      await expect(await (await dbService.db.prepare(`
        SELECT scope_kind, widget_instance_id, preview_id
        FROM idempotency_records
        WHERE org_id = ? AND invocation_id = ?
      `)).get(tenant.orgId, previewAccepted.id)).toEqual({
        scope_kind: 'widget_preview',
        widget_instance_id: null,
        preview_id: previewId,
      });
      await (await dbService.db.prepare(`
        UPDATE agent_previews
        SET active_revision_id = ?, updated_at_ms = 46
        WHERE org_id = ? AND id = ?
      `)).run(uuid(974), tenant.orgId, previewId);
      const retainedAccepted = await functionInvocation.invokeFunction(wsTenant, {
        widgetInstanceId: previewId,
        widgetRevisionId: previewRevisionId,
        functionName: 'echo',
        input: { value: 'retained' },
        idempotencyKey: 'function-composition-retained-preview-key',
      });
      const retainedTerminal = await waitFor(
        () => functionInvocation.getFunctionInvocation(wsTenant, retainedAccepted.id),
        (value) => value !== null
          && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(value.status),
      );
      expect(retainedTerminal).toMatchObject({
        status: 'succeeded',
        widgetRevisionId: previewRevisionId,
        output: { value: 'echo:retained' },
      });
      await expect(authoringStore.releasePreviewMountLease(tenant, {
        leaseId: previewMountLeaseId,
        previewId,
        previewRevisionId,
        canvasId: tenant.canvasId!,
        frameNodeId: 'function-composition-preview-frame',
        nowMs: previewMountLeaseNowMs + 1,
      })).resolves.toBe(true);
      await expect(functionInvocation.invokeFunction(wsTenant, {
        widgetInstanceId: previewId,
        widgetRevisionId: previewRevisionId,
        functionName: 'echo',
        input: { value: 'unmounted' },
        idempotencyKey: 'function-composition-unmounted-preview-key',
      })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_NOT_FOUND' });
      await expect(functionInvocation.invokeFunction(wsTenant, {
        widgetInstanceId: previewId,
        widgetRevisionId: uuid(975),
        functionName: 'echo',
        input: { value: 'stale' },
        idempotencyKey: 'function-composition-stale-preview-key',
      })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_NOT_FOUND' });

      await canvasService.execute(tenant, {
        commandId: uuid(969),
        canvasId: tenant.canvasId!,
        baseRevision: inserted.revision,
        operations: [{ type: 'delete', itemId: 'function-element' }],
        preconditions: [{
          type: 'item-revision',
          itemId: 'function-element',
          itemRevision: 0,
        }],
      });
      await expect(functionInvocation.invokeFunction(wsTenant, {
        widgetInstanceId: uuid(966),
        widgetRevisionId: published.revision.id,
        functionName: 'echo',
        input: { value: 'archived' },
        idempotencyKey: 'function-composition-archived',
      })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_ARCHIVED' });
    } finally {
      await functionOwner.stop();
      await resourceOwner.stop();
      await widgetOwner.stop();
      await dbService.stop();
    }
  }, 30_000);
});

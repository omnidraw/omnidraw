import { afterEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TAgentEvent,
} from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { AgentService } from '../src/AgentService';
import { createLegacyActorAgentCapabilityFactory } from '../src/legacy/LegacyActorAgentCapability';
import { fnBuildWidgetCreateManifest } from '../src/tools/fn.widget-create';
import { createWidgetWorkspaceTools } from '../src/tools/tool.widget-workspace';
import { WidgetManagement } from '../src/widget-management/WidgetManagement';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { executeTool } from './tool.test-helpers';
import { TEST_TENANT, TestTenantEventPublisher } from './tenant.fixture';
import {
  createWidgetAuthoringHarness,
  createWidgetDraftControllerForWorkspace,
} from './widget-authoring.fixture';

class TestEvents extends TestTenantEventPublisher {
  events: TAgentEvent[] = [];
  override publishAgentEvent(event: TAgentEvent): number {
    this.events.push(event);
    return super.publishAgentEvent(event);
  }
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vc-widget-management-'));
  roots.push(root);
  const dataPath = join(root, 'data');
  const configPath = join(root, 'config');
  await mkdir(join(configPath, 'widgets'), { recursive: true });
  const workspace = new WidgetWorkspace({ dataPath, configPath });
  await workspace.init();
  const events = new TestEvents();
  const { controller, store, widgets } = createWidgetDraftControllerForWorkspace(workspace, events);
  const manager = new WidgetManagement({ workspace, drafts: controller });
  const tools = createWidgetWorkspaceTools({
    workspace,
    chatId: 'catalog-test',
    authorize: async () => true,
    onDraftChanged: (change) => controller.handleToolChange({ ...change, chatId: 'catalog-test' }),
  });
  const created = await executeTool(tools.find((tool) => tool.name === 'vc_widget_create')!, {
    name: 'Camera',
    description: 'Captures a frame.',
  });
  return { root, workspace, controller, store, manager, events, widgets, tools, created };
}

describe('WidgetManagement', () => {
  test('reports trusted controller validation and durable identity from the validate tool', async () => {
    const { controller, widgets, tools, created } = await fixture();
    const draft = await controller.getByName('Camera');
    expect(created.details).toMatchObject({ draftId: draft!.draftId });
    widgets.validateBuildResult = {
      valid: false,
      diagnostics: ['Widget ui build failed.'],
    };

    const validated = await executeTool(
      tools.find((tool) => tool.name === 'vc_widget_validate')!,
      { name: 'Camera' },
    );

    expect(validated.details).toMatchObject({
      draftId: draft!.draftId,
      revision: draft!.revision,
      ok: false,
      errors: ['Widget ui build failed.'],
    });
    expect(await controller.get(draft!.draftId)).toMatchObject({
      validation: {
        status: 'invalid',
        errors: ['Widget ui build failed.'],
        validatedRevision: draft!.revision,
      },
      publishReady: false,
    });
  });

  test('collapses identical drafts and exposes divergent versions after a byte change', async () => {
    const { workspace, controller, manager, widgets } = await fixture();
    await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });

    const same = await manager.catalog([{ name: 'Media', icon: null }]);
    expect(same.widgets[0]).toMatchObject({ name: 'Camera', relation: 'same' });
    expect(same.widgets[0]?.published?.contentFingerprint).toBe(same.widgets[0]?.draft?.contentFingerprint);
    expect(JSON.stringify(same)).not.toContain(workspace.draftRoot);
    expect(same.widgets[0]?.draft?.placement).toMatchObject({
      reference: { source: 'draft', name: 'Camera' },
      bounds: { width: 360, height: 320 },
    });

    await writeFile(join(workspace.draftRoot, 'Camera', 'ui', 'styles.css'), '.draft-change {}\n', 'utf8');
    await controller.handleToolChange({ name: 'Camera', type: 'changed' });
    const different = await manager.catalog([{ name: 'Media', icon: null }]);
    expect(different.widgets[0]?.relation).toBe('different');
    expect(different.generation).not.toBe(same.generation);
    controller.close();
  });

  test('uses fallback placement bounds and exposes only a ready current Preview', async () => {
    const { workspace, controller, manager, widgets } = await fixture();
    await controller.handleToolChange({ name: 'Camera', type: 'changed' });
    const before = await manager.catalog([]);
    expect(before.widgets[0]?.draft?.placement?.bounds).toEqual({ width: 360, height: 320 });
    expect(before.widgets[0]?.preview).toMatchObject({ status: 'not-ready', placement: null });

    widgets.validateBuildResult = { valid: false, diagnostics: ['private diagnostic'] };
    await controller.handleToolChange({
      name: 'Camera',
      type: 'validated',
      validation: { ok: true, errors: [], warnings: [] },
    });
    expect((await manager.catalog([])).widgets[0]?.preview).toEqual({
      status: 'failed',
      revision: before.widgets[0]!.draft!.revision,
      message: 'Draft validation failed. Open the draft for diagnostics.',
      placement: null,
    });
    widgets.validateBuildResult = { valid: true, diagnostics: [] };
    await controller.handleToolChange({ name: 'Camera', type: 'changed' });

    const revision = before.widgets[0]!.draft!.revision;
    const draft = await controller.getByName('Camera');
    expect(await controller.buildPreview(draft!.draftId, 'catalog-owner', revision, null)).toMatchObject({ ready: true, revision });
    const ready = await manager.catalog([]);
    expect(ready.widgets[0]?.preview).toMatchObject({
      status: 'ready',
      revision,
      placement: {
        reference: { source: 'preview', name: 'Camera', revision },
        bounds: { width: 360, height: 320 },
      },
    });
    await controller.close();
  });

  test('inspects only managed relative files and reads text lazily', async () => {
    const { root, workspace, controller, manager } = await fixture();
    await mkdir(join(workspace.draftRoot, 'Camera', 'node_modules', 'private'), { recursive: true });
    await writeFile(join(workspace.draftRoot, 'Camera', 'node_modules', 'private', 'secret.js'), 'hidden', 'utf8');

    const files = await manager.files('Camera', 'draft');
    expect(files?.some((entry) => entry.path.includes('node_modules'))).toBe(false);
    expect(files?.some((entry) => entry.path === 'ui/main.ts')).toBe(true);
    expect(await manager.file('Camera', 'draft', 'ui/main.ts')).toMatchObject({ binary: false, truncated: false });
    await expect(manager.file('Camera', 'draft', '../vibecanvas.json')).rejects.toThrow('UNSAFE_PATH');
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await symlink(outside, join(workspace.draftRoot, 'Camera', 'escape'));
    await expect(manager.file('Camera', 'draft', 'escape/secret.txt')).rejects.toThrow('UNSAFE_PATH');
    controller.close();
  });

  test('fails equality closed for symlinks and applies optimistic v2 metadata edits', async () => {
    const { root, workspace, controller, manager } = await fixture();
    await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'outside', 'utf8');
    await symlink(outside, join(workspace.draftRoot, 'Camera', 'outside-link'));
    expect((await manager.catalog([])).widgets[0]).toMatchObject({ relation: 'unknown', problem: { code: 'AMBIGUOUS_SOURCE' } });
    await rm(join(workspace.draftRoot, 'Camera', 'outside-link'));

    const detail = await manager.detail('Camera', 'draft');
    const updated = await manager.patchDraftMetadata('Camera', detail!.variant.revision, { description: 'Updated camera.' });
    expect(updated.variant.description).toBe('Updated camera.');
    const manifest = JSON.parse(await readFile(join(workspace.draftRoot, 'Camera', 'vibecanvas.json'), 'utf8'));
    expect(manifest.description).toBe('Updated camera.');
    await expect(manager.patchDraftMetadata('Camera', detail!.variant.revision, { description: 'Stale.' })).rejects.toThrow('STALE_REVISION');
    const current = await manager.detail('Camera', 'draft');
    await expect(manager.patchDraftTool('Camera', current!.variant.revision, { group: null })).rejects.toThrow('Manifest v2');
    controller.close();
  });

  test('preserves a safe group reference from an otherwise invalid manifest', async () => {
    const { workspace, controller, manager } = await fixture();
    await writeFile(join(workspace.draftRoot, 'Camera', 'vibecanvas.json'), JSON.stringify({
      name: 'Camera',
      widget: { tool: { group: 'Media' } },
    }), 'utf8');
    const entry = (await manager.catalog([{ name: 'Media', icon: null }])).widgets[0];
    expect(entry).toMatchObject({
      relation: 'draft-only',
      problem: { code: 'INVALID_MANIFEST' },
      draft: { tool: { group: 'Media' } },
    });
    controller.close();
  });

  test('edits structured draft metadata and safely renames the draft identity', async () => {
    const { workspace, controller, manager } = await fixture();
    await workspace.ensureChat('second-catalog-test');
    const detail = await manager.detail('Camera', 'draft');
    const result = await manager.patchDraftMetadata('Camera', detail!.variant.revision, {
      name: 'Studio Camera',
      description: 'Captures a studio frame.',
    });

    expect(result).toMatchObject({
      name: 'Studio Camera',
      variant: {
        displayName: 'Studio Camera',
        description: 'Captures a studio frame.',
        tool: { label: 'Studio Camera' },
      },
    });
    expect(await workspace.getDraft('Camera')).toBeNull();
    expect(await workspace.getDraft('Studio Camera')).not.toBeNull();
    expect(await workspace.listMounts('catalog-test')).toEqual([
      expect.objectContaining({ name: 'Studio Camera', source: 'draft' }),
    ]);
    expect(await workspace.listMounts('second-catalog-test')).toEqual([
      expect.objectContaining({ name: 'Studio Camera', source: 'draft' }),
    ]);
    const manifest = JSON.parse(await readFile(join(workspace.draftRoot, 'Studio Camera', 'vibecanvas.json'), 'utf8'));
    expect(manifest).toMatchObject({ schemaVersion: 2, name: 'Studio Camera', description: 'Captures a studio frame.' });
    controller.close();
  });

  test('does not commit a rename when Preview cleanup fails', async () => {
    const { workspace, controller, manager } = await fixture();
    const detail = await manager.detail('Camera', 'draft');
    controller.withPreviewRenameCleanup = async (_name, _nextName, operation) => {
      const cleanup = async () => {
        throw new Error('Preview Actor did not stop.');
      };
      return operation(cleanup, async (commit) => {
        await cleanup();
        await commit();
      });
    };

    await expect(manager.patchDraftMetadata('Camera', detail!.variant.revision, {
      name: 'Renamed Camera',
    })).rejects.toThrow('Preview Actor did not stop.');
    expect(await workspace.getDraft('Camera')).not.toBeNull();
    expect(await workspace.getDraft('Renamed Camera')).toBeNull();
    await controller.close();
  });

  test('validates a rename before cleaning up its active Preview', async () => {
    const { workspace, controller, manager } = await fixture();
    const detail = await manager.detail('Camera', 'draft');
    const draft = await controller.getByName('Camera');
    expect((await controller.buildPreview(draft!.draftId, 'rename-owner', detail!.variant.revision, null)).ready).toBe(true);
    const original = controller.withPreviewRenameCleanup.bind(controller);
    let cleanupCalls = 0;
    controller.withPreviewRenameCleanup = (name, nextName, operation) => {
      return original(name, nextName, (cleanup, coordinateCommit) => operation(
        cleanup,
        async (commit) => coordinateCommit(async () => {
          cleanupCalls += 1;
          await commit();
        }),
      ));
    };

    await expect(manager.patchDraftMetadata('Camera', 'stale-revision', {
      name: 'Renamed Camera',
    })).rejects.toThrow('STALE_REVISION');

    expect(cleanupCalls).toBe(0);
    expect(await workspace.getDraft('Camera')).not.toBeNull();
    expect(await controller.getPreview(draft!.draftId, 'rename-owner')).toMatchObject({ ready: true });
    await controller.close();
  });

  test('deletes only a draft from the draft route and both variants from the published route', async () => {
    const first = await fixture();
    await first.workspace.ensureChat('second-catalog-test');
    expect(await first.manager.delete('Camera', 'draft')).toMatchObject({
      deletedDefinition: false,
      deletedDraft: true,
      deletedPublished: false,
      deletedInstances: false,
      issues: [],
    });
    expect(await first.workspace.getDraft('Camera')).toBeNull();
    expect(await first.workspace.listMounts('catalog-test')).toEqual([]);
    expect(await first.workspace.listMounts('second-catalog-test')).toEqual([]);
    first.controller.close();

    const second = await fixture();
    await cp(join(second.workspace.draftRoot, 'Camera'), join(second.workspace.publishedRoot, 'Camera'), { recursive: true });
    const deletedDefinitions: string[] = [];
    const manager = new WidgetManagement({
      workspace: second.workspace,
      drafts: second.controller,
      deletePublishedDefinition: async (name) => { deletedDefinitions.push(name); return true; },
    });
    expect(await manager.delete('Camera', 'published')).toMatchObject({
      deletedDefinition: true,
      deletedDraft: true,
      deletedPublished: true,
      deletedInstances: true,
      issues: [],
    });
    expect(deletedDefinitions).toEqual(['Camera']);
    expect(await second.workspace.getDraft('Camera')).toBeNull();
    expect(await manager.detail('Camera', 'published')).toBeNull();
    second.controller.close();
  });

  test('does not delete a published definition or source when Preview cleanup fails', async () => {
    const { workspace, controller } = await fixture();
    await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });
    const deletedDefinitions: string[] = [];
    const manager = new WidgetManagement({
      workspace,
      drafts: controller,
      deletePublishedDefinition: async (name) => {
        deletedDefinitions.push(name);
        return true;
      },
    });
    controller.withPreviewCleanup = async (_name, operation) => {
      const cleanup = async () => {
        throw new Error('Preview cleanup failed.');
      };
      return operation(cleanup, cleanup);
    };

    await expect(manager.delete('Camera', 'published')).rejects.toThrow('Preview cleanup failed');
    expect(deletedDefinitions).toEqual([]);
    expect(await workspace.getDraft('Camera')).not.toBeNull();
    expect(await manager.detail('Camera', 'published')).not.toBeNull();
    await controller.close();
  });

  test('leaves runtime and both sources untouched when durable discard conflicts or throws', async () => {
    for (const fault of ['conflict', 'throw'] as const) {
      const { workspace, controller, store } = await fixture();
      const draft = await controller.getByName('Camera');
      await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });
      if (fault === 'conflict') store.conflictDiscardDraft = true;
      else store.throwDiscardDraftError = true;
      const deletedDefinitions: string[] = [];
      const manager = new WidgetManagement({
        workspace,
        drafts: controller,
        deletePublishedDefinition: async (name) => {
          deletedDefinitions.push(name);
          return true;
        },
      });

      await expect(manager.delete('Camera', 'published')).rejects.toThrow();
      expect(deletedDefinitions).toEqual([]);
      expect(await workspace.getDraft('Camera')).not.toBeNull();
      expect(await manager.detail('Camera', 'published')).not.toBeNull();
      expect(store.drafts.get(draft!.draftId)).toMatchObject({ status: 'editing' });
      await controller.close();
    }
  });

  test('removes orphaned published sources and drafts when no runtime definition exists', async () => {
    const { workspace, controller } = await fixture();
    await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });
    await writeFile(join(workspace.publishedRoot, 'Camera', 'vibecanvas.json'), '{ invalid json', 'utf8');
    const attemptedDefinitions: string[] = [];
    const manager = new WidgetManagement({
      workspace,
      drafts: controller,
      deletePublishedDefinition: async (name) => { attemptedDefinitions.push(name); return false; },
    });

    expect(await manager.delete('Camera', 'published')).toMatchObject({
      deletedDefinition: false,
      deletedPublished: true,
      deletedDraft: true,
      deletedInstances: false,
      issues: [{ target: 'runtime-definition' }],
    });
    expect(attemptedDefinitions).toEqual(['Camera']);
    expect(await manager.detail('Camera', 'published')).toBeNull();
    expect(await workspace.getDraft('Camera')).toBeNull();
    controller.close();
  });

  test('continues source cleanup when runtime deletion fails', async () => {
    const { workspace, controller } = await fixture();
    await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });
    const manager = new WidgetManagement({
      workspace,
      drafts: controller,
      deletePublishedDefinition: async () => { throw new Error('runtime failed'); },
    });

    expect(await manager.delete('Camera', 'published')).toMatchObject({
      deletedDefinition: false,
      deletedPublished: true,
      deletedDraft: true,
      deletedInstances: false,
      issues: [{ target: 'runtime-definition' }],
    });
    expect(await manager.detail('Camera', 'published')).toBeNull();
    expect(await workspace.getDraft('Camera')).toBeNull();
    controller.close();
  });

  test('retries a source snapshot when files change between fingerprint and manifest read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-widget-snapshot-'));
    roots.push(root);
    const dataPath = join(root, 'data');
    const configPath = join(root, 'config');
    await mkdir(join(configPath, 'widgets'), { recursive: true });
    const workspace = new WidgetWorkspace({ dataPath, configPath });
    await workspace.init();
    const { controller } = createWidgetDraftControllerForWorkspace(workspace, new TestEvents());
    const publishedRoot = join(workspace.publishedRoot, 'Camera');
    await mkdir(join(publishedRoot, 'ui'), { recursive: true });
    await writeFile(
      join(publishedRoot, 'vibecanvas.json'),
      JSON.stringify(fnBuildWidgetCreateManifest({ name: 'Camera' })),
      'utf8',
    );
    await writeFile(join(publishedRoot, 'ui', 'main.ts'), 'export default {}', 'utf8');
    const manager = new WidgetManagement({ workspace, drafts: controller });
    const before = (await manager.catalog([])).widgets[0]?.published;
    if (!before?.placement) throw new Error('Expected published placement fixture.');

    let mutated = false;
    const raced = new WidgetManagement({
      workspace,
      drafts: controller,
      afterVariantFingerprint: async ({ source, attempt }) => {
        if (source !== 'published' || attempt !== 1 || mutated) return;
        mutated = true;
        const manifestPath = join(workspace.publishedRoot, 'Camera', 'vibecanvas.json');
        const nextManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        nextManifest.slug = 'camera-v2';
        await writeFile(manifestPath, JSON.stringify(nextManifest), 'utf8');
      },
    });

    await expect(raced.resolvePlacementReference(before.placement.reference)).resolves.toMatchObject({
      ok: false,
      code: 'STALE_REVISION',
    });
    const after = (await raced.catalog([])).widgets[0]?.published;
    expect(after).toMatchObject({
      slug: 'camera-v2',
      placement: { bounds: { width: 360, height: 320 } },
    });
    expect(after?.revision).not.toBe(before.revision);
    await controller.close();
  });

  test('fences Preview placement when a name changes durable draft ownership after pre-resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-widget-placement-owner-race-'));
    roots.push(root);
    const events = new TestEvents();
    const harness = await createWidgetAuthoringHarness(root, events);
    const original = await harness.createDraft('Camera');
    let id = 100;
    let nowMs = 20_000;
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: root,
      configPath: join(root, 'config'),
      eventPublisherService: events,
      tenant: TEST_TENANT,
      authoringStore: harness.store,
      widgetAuthoringCapability: harness.widgets,
      previewFunctionCapability: harness.previewFunctions,
      resolveWidgetResourceBindings: async () => [],
      createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
      nowMs: () => ++nowMs,
      widgetBuilderIdentity: 'placement-owner-race/1',
    });
    await service.start({ config: {}, hooks: {} });

    const detail = await service.getWidgetDetail('Camera', 'draft');
    const reference = detail?.variant.placement?.reference;
    if (!reference) throw new Error('Expected a draft placement reference.');
    const replacementDraftId = '00000000-0000-4000-8000-000000000999';
    const durable = harness.store.drafts.get(original.draftId);
    if (!durable) throw new Error('Expected the original durable draft.');
    harness.store.drafts.set(original.draftId, { ...durable, status: 'discarded' });
    harness.store.drafts.set(replacementDraftId, {
      ...durable,
      id: replacementDraftId,
      definitionId: '00000000-0000-4000-8000-000000000998',
      status: 'editing',
    });

    const previewId = '00000000-0000-4000-8000-000000000997';
    await expect(service.resolveWidgetPlacement(
      reference,
      previewId,
      original.draftId,
    )).resolves.toMatchObject({
      ok: false,
      code: 'STALE_REVISION',
      currentRevision: detail.variant.revision,
    });
    expect(harness.widgets.previews.has(previewId)).toBe(false);

    await service.stop();
    await harness.controller.close();
  });

  test('resolves exact v2 placement before consulting the explicit legacy actor fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-widget-placement-'));
    roots.push(root);
    const dataPath = join(root, 'data');
    const configPath = join(root, 'config');
    const publishedRoot = join(dataPath, 'pi', 'agent', 'widgets', 'published', 'Camera');
    await mkdir(join(publishedRoot, 'widget'), { recursive: true });
    const manifest = fnBuildWidgetCreateManifest({ name: 'Camera' });
    await writeFile(join(publishedRoot, 'vibecanvas.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(publishedRoot, 'widget', 'main.ts'), 'export default {}', 'utf8');

    const neutralTarget = {
      definitionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      revisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
      name: 'Weather v2',
      slug: 'weather-v2',
      description: null,
      contractDigestSha256: 'c'.repeat(64),
      updatedAtMs: 10,
      bounds: { width: 360, height: 320 },
    };
    const resolvedIdentities: Array<{ definitionId: string; revisionId: string }> = [];
    let v2Active = true;
    let legacyActorLookups = 0;
    let legacyRuntimeManifest = { ...manifest, manifest_path: publishedRoot };
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath,
      configPath,
      eventPublisherService: new TestEvents(),
      listPublishedWidgetPlacements: async () => [neutralTarget],
      resolvePublishedWidgetPlacement: async (identity) => {
        resolvedIdentities.push(identity);
        return v2Active ? neutralTarget : null;
      },
      legacyActor: createLegacyActorAgentCapabilityFactory({
        actorService: {},
        resolvePublishedWidgetManifest: async () => {
          legacyActorLookups += 1;
          return legacyRuntimeManifest as never;
        },
      }),
    });
    await service.start({ config: {}, hooks: {} });

    const catalog = await service.getWidgetCatalog([]);
    const published = catalog.widgets.find((entry) => entry.name === neutralTarget.name)?.published;
    if (!published?.placement) throw new Error('Expected published fixture.');
    const reference = published.placement.reference;
    await expect(service.resolveWidgetPlacement(reference)).resolves.toMatchObject({
      ok: true,
      descriptor: {
        kind: 'published-v2',
        draftId: null,
        definitionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        revisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
        definitionName: null,
        definitionSlug: neutralTarget.slug,
        previewId: null,
      },
    });
    expect(resolvedIdentities).toEqual([{
      definitionId: neutralTarget.definitionId,
      revisionId: neutralTarget.revisionId,
    }]);
    expect(legacyActorLookups).toBe(0);

    v2Active = false;
    await expect(service.resolveWidgetPlacement(reference)).resolves.toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(legacyActorLookups).toBe(0);

    const legacy = catalog.widgets.find((entry) => entry.name === manifest.name)?.published;
    if (!legacy?.placement) throw new Error('Expected legacy published fixture.');
    legacyRuntimeManifest = {
      ...legacyRuntimeManifest,
      slug: 'stale-runtime-slug',
    };
    await expect(service.resolveWidgetPlacement(legacy.placement.reference)).resolves.toMatchObject({
      ok: false,
      code: 'STALE_REVISION',
    });
    expect(legacyActorLookups).toBe(1);

    legacyRuntimeManifest = { ...manifest, manifest_path: publishedRoot };
    await expect(service.resolveWidgetPlacement(legacy.placement.reference)).resolves.toMatchObject({
      ok: true,
      descriptor: {
        kind: 'published-legacy',
        draftId: null,
        definitionId: null,
        revisionId: null,
        definitionName: manifest.name,
        definitionSlug: manifest.slug,
        previewId: null,
      },
    });
    expect(legacyActorLookups).toBe(2);

    await service.stop();
  });

  test('rejects over-limit and malformed published placement catalogs at the agent boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-widget-catalog-boundary-'));
    roots.push(root);
    const target = {
      definitionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      revisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
      name: 'Weather v2',
      slug: 'weather-v2',
      description: null,
      contractDigestSha256: 'c'.repeat(64),
      updatedAtMs: 10,
      bounds: { width: 360, height: 320 },
    };
    let injectedTargets: unknown = Array.from({ length: 1_001 }, () => target);
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: join(root, 'data'),
      configPath: join(root, 'config'),
      eventPublisherService: new TestEvents(),
      listPublishedWidgetPlacements: async () => injectedTargets as never,
    });
    await service.start({ config: {}, hooks: {} });

    await expect(service.getWidgetCatalog([])).rejects.toThrow('OPERATION_UNAVAILABLE');
    injectedTargets = [{
      ...target,
      bounds: { width: Number.POSITIVE_INFINITY, height: 320 },
      unexpectedActorDefinition: 'Weather',
    }];
    await expect(service.getWidgetCatalog([])).rejects.toThrow('OPERATION_UNAVAILABLE');
    injectedTargets = [target, {
      ...target,
      definitionId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      revisionId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
      slug: 'weather-v3',
    }];
    await expect(service.getWidgetCatalog([])).rejects.toThrow('OPERATION_UNAVAILABLE');
    injectedTargets = [target, {
      ...target,
      definitionId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      name: 'Weather v3',
      slug: 'weather-v3',
    }];
    await expect(service.getWidgetCatalog([])).rejects.toThrow('OPERATION_UNAVAILABLE');

    await service.stop();
  });
});

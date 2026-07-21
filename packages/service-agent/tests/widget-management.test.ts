import { afterEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TAgentEvent,
} from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { createWidgetWorkspaceTools } from '../src/tools/tool.widget-workspace';
import { WidgetDraftController } from '../src/widget-drafts/WidgetDraftController';
import { WidgetManagement } from '../src/widget-management/WidgetManagement';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { executeTool } from './tool.test-helpers';
import { TestTenantEventPublisher } from './tenant.fixture';

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
  const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: events });
  const manager = new WidgetManagement({ workspace, drafts: controller });
  const tools = createWidgetWorkspaceTools({
    workspace,
    chatId: 'catalog-test',
    authorize: async () => true,
    onDraftChanged: (change) => controller.handleToolChange(change),
  });
  await executeTool(tools.find((tool) => tool.name === 'vc_widget_create')!, {
    name: 'Camera',
    description: 'Captures a frame.',
  });
  return { root, workspace, controller, manager, events };
}

describe('WidgetManagement', () => {
  test('collapses identical drafts and exposes divergent versions after a byte change', async () => {
    const { workspace, controller, manager } = await fixture();
    await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });

    const same = await manager.catalog([{ name: 'Media', icon: null }]);
    expect(same.widgets[0]).toMatchObject({ name: 'Camera', relation: 'same' });
    expect(same.widgets[0]?.published?.contentFingerprint).toBe(same.widgets[0]?.draft?.contentFingerprint);
    expect(JSON.stringify(same)).not.toContain(workspace.draftRoot);
    expect(same.widgets[0]?.draft?.placement).toMatchObject({
      reference: { source: 'draft', name: 'Camera' },
      bounds: { width: 360, height: 320 },
    });

    await writeFile(join(workspace.draftRoot, 'Camera', 'widget', 'main.css'), '.draft-change {}\n', 'utf8');
    await controller.handleToolChange({ name: 'Camera', type: 'changed' });
    const different = await manager.catalog([{ name: 'Media', icon: null }]);
    expect(different.widgets[0]?.relation).toBe('different');
    expect(different.generation).not.toBe(same.generation);
    controller.close();
  });

  test('uses fallback placement bounds and exposes only a ready current Preview', async () => {
    const { workspace, controller, manager } = await fixture();
    const manifestPath = join(workspace.draftRoot, 'Camera', 'vibecanvas.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.widget.frame;
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await controller.handleToolChange({ name: 'Camera', type: 'changed' });
    const before = await manager.catalog([]);
    expect(before.widgets[0]?.draft?.placement?.bounds).toEqual({ width: 360, height: 320 });
    expect(before.widgets[0]?.preview).toMatchObject({ status: 'not-ready', placement: null });

    await controller.handleToolChange({
      name: 'Camera',
      type: 'validated',
      validation: { ok: false, errors: ['private diagnostic'], warnings: [] },
    });
    expect((await manager.catalog([])).widgets[0]?.preview).toEqual({
      status: 'failed',
      revision: before.widgets[0]!.draft!.revision,
      message: 'Draft validation failed. Open the draft for diagnostics.',
      placement: null,
    });
    await controller.handleToolChange({ name: 'Camera', type: 'changed' });

    const revision = before.widgets[0]!.draft!.revision;
    expect(await controller.buildPreview('Camera', 'catalog-owner', revision)).toMatchObject({ ready: true, revision });
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
    expect(files?.some((entry) => entry.path === 'widget/main.ts')).toBe(true);
    expect(await manager.file('Camera', 'draft', 'widget/main.ts')).toMatchObject({ binary: false, truncated: false });
    await expect(manager.file('Camera', 'draft', '../vibecanvas.json')).rejects.toThrow('UNSAFE_PATH');
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await symlink(outside, join(workspace.draftRoot, 'Camera', 'escape'));
    await expect(manager.file('Camera', 'draft', 'escape/secret.txt')).rejects.toThrow('UNSAFE_PATH');
    controller.close();
  });

  test('fails equality closed for symlinks and applies optimistic tool edits', async () => {
    const { root, workspace, controller, manager } = await fixture();
    await cp(join(workspace.draftRoot, 'Camera'), join(workspace.publishedRoot, 'Camera'), { recursive: true });
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'outside', 'utf8');
    await symlink(outside, join(workspace.draftRoot, 'Camera', 'outside-link'));
    expect((await manager.catalog([])).widgets[0]).toMatchObject({ relation: 'unknown', problem: { code: 'AMBIGUOUS_SOURCE' } });
    await rm(join(workspace.draftRoot, 'Camera', 'outside-link'));

    const detail = await manager.detail('Camera', 'draft');
    const updated = await manager.patchDraftTool('Camera', detail!.variant.revision, { group: 'Media', icon: null });
    expect(updated.tool.group).toBe('Media');
    const manifest = JSON.parse(await readFile(join(workspace.draftRoot, 'Camera', 'vibecanvas.json'), 'utf8'));
    expect(manifest.widget.tool.group).toBe('Media');
    await expect(manager.patchDraftTool('Camera', detail!.variant.revision, { group: null })).rejects.toThrow('STALE_REVISION');
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
      tool: { label: 'Studio capture', group: null, priority: 7 },
    });

    expect(result).toMatchObject({
      name: 'Studio Camera',
      variant: {
        displayName: 'Studio Camera',
        description: 'Captures a studio frame.',
        tool: { label: 'Studio capture', priority: 7 },
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
    expect(manifest).toMatchObject({ name: 'Studio Camera', description: 'Captures a studio frame.', widget: { tool: { label: 'Studio capture', priority: 7 } } });
    controller.close();
  });

  test('does not commit a rename when Preview cleanup fails', async () => {
    const { workspace, controller, manager } = await fixture();
    const detail = await manager.detail('Camera', 'draft');
    controller.withPreviewRenameCleanup = async (_name, _nextName, operation) => {
      return operation(async () => {
        throw new Error('Preview Actor did not stop.');
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
    expect((await controller.buildPreview('Camera', 'rename-owner', detail!.variant.revision)).ready).toBe(true);
    const original = controller.withPreviewRenameCleanup.bind(controller);
    let cleanupCalls = 0;
    controller.withPreviewRenameCleanup = (name, nextName, operation) => {
      return original(name, nextName, (cleanup) => operation(async () => {
        cleanupCalls += 1;
        await cleanup();
      }));
    };

    await expect(manager.patchDraftMetadata('Camera', 'stale-revision', {
      name: 'Renamed Camera',
    })).rejects.toThrow('STALE_REVISION');

    expect(cleanupCalls).toBe(0);
    expect(await workspace.getDraft('Camera')).not.toBeNull();
    expect(await controller.getPreview('Camera', 'rename-owner')).toMatchObject({ ready: true });
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
      return operation(async () => {
        throw new Error('Preview cleanup failed.');
      });
    };

    await expect(manager.delete('Camera', 'published')).rejects.toThrow('Preview cleanup failed');
    expect(deletedDefinitions).toEqual([]);
    expect(await workspace.getDraft('Camera')).not.toBeNull();
    expect(await manager.detail('Camera', 'published')).not.toBeNull();
    await controller.close();
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
});

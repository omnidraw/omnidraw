import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { WidgetManagement } from '../src/widget-management/WidgetManagement';
import { createWidgetAuthoringHarness } from './widget-authoring.fixture';
import { createTestTenantEvents, TEST_TENANT } from './tenant.fixture';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function harness(eventPublisher?: ITenantEventPublisherService) {
  const root = await mkdtemp(join(tmpdir(), 'vc-agent-stateless-preview-'));
  roots.push(root);
  return { root, ...await createWidgetAuthoringHarness(root, eventPublisher) };
}

describe('WidgetDraftController stateless Preview', () => {
  test('persists a created draft before publishing its sidebar refresh event', async () => {
    const events = createTestTenantEvents();
    const iterator = events.subscribeAgentEvents()[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const { createDraft, store } = await harness(events);

    const draft = await createDraft('Sidebar Clock');

    expect(await store.getDraft(TEST_TENANT, draft.draftId)).toMatchObject({
      id: draft.draftId,
      name: draft.name,
      sourceDigestSha256: draft.revision,
    });
    await expect(nextEvent).resolves.toEqual({
      done: false,
      value: {
        kind: 'widget-draft',
        type: 'created',
        draftId: draft.draftId,
        revision: draft.revision,
      },
    });
    await iterator.return?.();
  });

  test('returns verified UI bytes with no durable Preview identity', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Browser Clock');
    const preview = await controller.buildPreview(draft.draftId);

    expect(preview.ready).toBe(true);
    if (!preview.ready) return;
    const bytes = Buffer.from(preview.uiArtifact.bytesBase64, 'base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(preview.uiArtifact.digestSha256);
    expect(preview.contract.functions).toEqual([]);
    expect(preview).not.toHaveProperty('previewId');
    expect(preview).not.toHaveProperty('previewRevisionId');
    expect(preview).not.toHaveProperty('expiresAtMs');
  });

  test('rebuilds from the current draft after source changes', async () => {
    const { root, controller, createDraft } = await harness();
    const draft = await createDraft('Refresh Clock');
    const first = await controller.buildPreview(draft.draftId);
    await writeFile(
      join(root, 'pi', 'agent', 'widgets', 'drafts', draft.name, 'ui', 'main.ts'),
      'document.body.append(document.createElement("output"));\n',
      'utf8',
    );
    const second = await controller.buildPreview(draft.draftId);
    expect(first.ready && second.ready && second.revision).not.toBe(first.ready ? first.revision : '');
  });

  test('requires no Preview cleanup when the controller closes', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Disposable Clock');
    expect((await controller.buildPreview(draft.draftId)).ready).toBe(true);
    await expect(controller.close()).resolves.toBeUndefined();
  });
});

describe('WidgetManagement manifest-v3 metadata', () => {
  test('exposes draft placement only after the exact revision passes trusted validation', async () => {
    const { workspace, controller, createDraft } = await harness();
    const draft = await createDraft('Validated Clock');
    const management = new WidgetManagement({ workspace, drafts: controller });

    const before = await management.detail(draft.name, 'draft');
    expect(before?.variant.validation?.status).toBe('unknown');
    expect(before?.variant.placement).toBeNull();

    await controller.validate(draft.draftId, draft.revision);

    const after = await management.detail(draft.name, 'draft');
    expect(after?.variant.validation).toMatchObject({
      status: 'valid',
      validatedRevision: draft.revision,
    });
    expect(after?.variant.placement?.reference).toEqual({
      source: 'draft',
      name: draft.name,
      revision: draft.revision,
    });
    expect((await management.catalog([])).widgets[0]?.preview).toMatchObject({
      status: 'ready',
      revision: draft.revision,
      placement: {
        reference: {
          source: 'draft',
          name: draft.name,
          revision: draft.revision,
        },
      },
    });
  });

  test('marks a filesystem-only orphan as needing validation and removes placement', async () => {
    const { workspace, controller } = await harness();
    await workspace.createDraft('orphan-chat', { name: 'Orphan Clock' }, async ({ cwd, name }) => {
      await mkdir(join(cwd, 'ui'), { recursive: true });
      await writeFile(join(cwd, 'ui', 'main.ts'), 'document.body.append(document.createElement("main"));\n', 'utf8');
      await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({
        schemaVersion: 3,
        name,
        slug: 'orphan-clock',
        ui: {
          runtime: 'capsule',
          entry: 'ui/main.ts',
          target: {
            runtimeAbi: 'quickjs-release-sync-v1',
            domProfile: 'dom-core-v2',
            featureProfiles: [],
          },
        },
      }, null, 2)}\n`, 'utf8');
      return ['vibecanvas.json', 'ui/main.ts'];
    });
    const management = new WidgetManagement({ workspace, drafts: controller });

    const detail = await management.detail('Orphan Clock', 'draft');

    expect(detail?.variant).toMatchObject({
      draftId: null,
      placement: null,
      validation: null,
    });
    expect(detail?.problem).toEqual({
      code: 'DRAFT_IDENTITY_UNAVAILABLE',
      message: 'Validate this widget again from its owning AI chat before publishing or placing it.',
    });
  });

  test('persists supported manifest metadata', async () => {
    const { workspace, controller, createDraft } = await harness();
    const draft = await createDraft('Editable Clock');
    const management = new WidgetManagement({ workspace, drafts: controller });

    const result = await management.patchDraftMetadata(draft.name, draft.revision, {
      description: 'A precise clock.',
    });

    expect(result.variant.description).toBe('A precise clock.');
    const manifest = JSON.parse(await readFile(
      join(workspace.draftRoot, draft.name, 'vibecanvas.json'),
      'utf8',
    ));
    expect(manifest.description).toBe('A precise clock.');
  });

  test('renames npm-backed drafts without capturing node_modules symlinks', async () => {
    const { workspace, controller, createDraft } = await harness();
    const draft = await createDraft('Linked Clock');
    const binDirectory = join(
      workspace.draftRoot,
      draft.name,
      'node_modules',
      '.bin',
    );
    await mkdir(binDirectory, { recursive: true });
    await symlink('../vite/bin/vite.js', join(binDirectory, 'vite'));
    const management = new WidgetManagement({ workspace, drafts: controller });

    const result = await management.patchDraftMetadata(draft.name, draft.revision, {
      name: 'Renamed Clock',
    });

    expect(result.name).toBe('Renamed Clock');
    expect(await readFile(
      join(workspace.draftRoot, 'Renamed Clock', 'vibecanvas.json'),
      'utf8',
    )).toContain('"name": "Renamed Clock"');
  });

  test('rejects tool metadata instead of reporting a successful no-op', async () => {
    const { workspace, controller, createDraft } = await harness();
    const draft = await createDraft('Strict Clock');
    const management = new WidgetManagement({ workspace, drafts: controller });

    await expect(management.patchDraftMetadata(draft.name, draft.revision, {
      tool: { label: 'Ignored label' },
    })).rejects.toThrow('Manifest v3 does not expose tool metadata.');
    await expect(management.patchDraftTool(draft.name, draft.revision, {
      group: 'Ignored group',
    })).rejects.toThrow('Manifest v3 does not expose tool metadata.');
  });
});

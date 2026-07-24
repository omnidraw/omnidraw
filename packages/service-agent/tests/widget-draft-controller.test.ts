import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WidgetManagement } from '../src/widget-management/WidgetManagement';
import { createWidgetAuthoringHarness } from './widget-authoring.fixture';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'vc-agent-stateless-preview-'));
  roots.push(root);
  return { root, ...await createWidgetAuthoringHarness(root) };
}

describe('WidgetDraftController stateless Preview', () => {
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

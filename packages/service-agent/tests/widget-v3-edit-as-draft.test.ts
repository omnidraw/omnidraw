import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from '../src/AgentService';
import {
  TEST_CAPSULE_BUILD_IDENTITY,
  TEST_CAPSULE_BUILD_POLICY_ID,
  createWidgetAuthoringHarness,
} from './widget-authoring.fixture';
import { TEST_TENANT, createTestTenantEvents } from './tenant.fixture';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('published v3 Edit as draft', () => {
  test('reconstructs the exact immutable source with publication identity and can republish', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-v3-edit-as-draft-'));
    roots.push(root);
    const { controller, store, widgets, createDraft } =
      await createWidgetAuthoringHarness(root);
    const original = await createDraft('Published Editor', true);
    const published = await controller.publish(original.draftId, original.revision);
    expect(published.published).toBe(true);
    if (!published.published) return;
    const revision = widgets.revisions.get(published.publishedRevisionId);
    if (!revision) throw new Error('Expected published revision fixture.');
    const source = widgets.revisionSources.get(revision.id);
    if (!source) throw new Error('Expected published source fixture.');
    const target = {
      definitionId: original.definitionId,
      revisionId: revision.id,
      name: revision.manifest.name,
      slug: revision.manifest.slug,
      description: revision.manifest.description ?? null,
      contractDigestSha256: revision.contractDigestSha256,
      updatedAtMs: revision.createdAtMs,
      bounds: { width: 360, height: 320 },
    } as const;
    let id = 0;
    let nowMs = revision.createdAtMs + 100;
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: root,
      configPath: join(root, 'config'),
      eventPublisherService: createTestTenantEvents(),
      tenant: TEST_TENANT,
      authoringStore: store,
      widgetAuthoringCapability: widgets,
      resolveWidgetResourceBindings: async () => [],
      createId: () => `90000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
      nowMs: () => ++nowMs,
      widgetBuilderIdentity: 'test-widget-builder/1',
      widgetCapsuleBuildIdentity: TEST_CAPSULE_BUILD_IDENTITY,
      widgetBuildPolicyId: TEST_CAPSULE_BUILD_POLICY_ID,
      listPublishedWidgetPlacements: async () => (
        widgets.activeRevisions.get(target.definitionId) === target.revisionId ? [target] : []
      ),
      resolvePublishedWidgetPlacement: async (identity) => (
        widgets.activeRevisions.get(identity.definitionId) === identity.revisionId
          ? target
          : null
      ),
    });
    await service.start({ config: {}, hooks: {} });

    expect(await service.deleteWidget(target.name, 'draft')).toMatchObject({
      deletedDraft: true,
      issues: [],
    });
    expect(await service.getWidgetDraft(original.draftId)).toBeNull();
    await expect(
      service.ensureWidgetDraft(target.name, 'f'.repeat(64)),
    ).rejects.toThrow('STALE_REVISION');
    expect(await service.getWidgetDetail(target.name, 'draft')).toBeNull();

    const materialized = await service.ensureWidgetDraft(
      target.name,
      target.contractDigestSha256,
    );
    const durable = await store.getDraftByName(TEST_TENANT, target.name);
    expect(materialized).toMatchObject({
      source: 'draft',
      draftId: durable?.id,
      revision: source.sourceDigestSha256,
    });
    expect(durable).toMatchObject({
      definitionId: target.definitionId,
      publishedRevisionId: target.revisionId,
      sourceDigestSha256: source.sourceDigestSha256,
      status: 'published',
    });
    expect(await readFile(
      join(root, 'pi', 'agent', 'widgets', 'drafts', target.name, 'ui', 'main.ts'),
      'utf8',
    )).toContain('document.body.append');

    if (!durable) throw new Error('Expected reconstructed durable draft.');
    expect(await service.validateWidgetDraft(durable.id, source.sourceDigestSha256)).toMatchObject({
      draftId: durable.id,
      definitionId: target.definitionId,
      revision: source.sourceDigestSha256,
      validation: { status: 'valid' },
    });
    expect(await service.publishWidgetDraft(durable.id, source.sourceDigestSha256)).toMatchObject({
      published: true,
      draftId: durable.id,
      definitionId: target.definitionId,
      revision: source.sourceDigestSha256,
    });

    await service.stop();
    await controller.close();
  });
});

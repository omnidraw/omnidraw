import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApproveActorCandidateTool } from '../src/tools/tool.approve-actor-candidate';
import { createPublishWidgetTool } from '../src/tools/tool.publish-widget';
import { createSetActorCandidateTool } from '../src/tools/tool.set-actor-candidate';
import type { TToolEvent } from '../src/tools/types';
import { createFakeSessionManager, executeTool, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('vc_publish_widget', () => {
  test('copies draft to final widgets directory and reloads actor service', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const events: TToolEvent[] = [];
    let reloadCount = 0;
    const sessionManager = createFakeSessionManager();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate: sampleCandidate() });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });

    const result = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      actorService: { reload: async () => { reloadCount += 1 } },
      onEvent: (event) => { events.push(event) },
    }), { confirm: true });

    expect(result.isError).toBeUndefined();
    expect(result.details.published).toBe(true);
    expect(reloadCount).toBe(1);
    expect(events.some((event) => event.type === 'widgetupdate')).toBe(true);

    const publishedManifest = JSON.parse(await readFile(join(finalWidgetsDir, 'counter-widget', 'vibecanvas.json'), 'utf8'));
    expect(publishedManifest.name).toBe('Counter Widget');
  });

  test('refuses unconfirmed publish', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const result = await executeTool(createPublishWidgetTool({ cwd, finalWidgetsDir }), { confirm: false });

    expect(result.isError).toBe(true);
    expect(result.details.published).toBe(false);
  });

  test('reloads existing instances only when edit publish keeps identity unchanged', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    let reloadCount = 0;
    let instanceReloadCount = 0;
    const sessionManager = createFakeSessionManager();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate: sampleCandidate() });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });

    const editSession = {
      mode: 'edit-published-widget' as const,
      sourceDefinitionName: 'Counter Widget',
      sourceSlug: 'counter-widget',
      sourceName: 'Counter Widget',
      sourceManifestPath: 'widgets/counter-widget/vibecanvas.json',
      previousVersion: '1',
      nextVersion: '2',
      startedAt: new Date().toISOString(),
    };

    const result = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      editSession,
      actorService: {
        reload: async () => { reloadCount += 1 },
        reloadDefinitionInstances: async () => { instanceReloadCount += 1 },
      },
    }), { confirm: true });

    expect(result.isError).toBeUndefined();
    expect(reloadCount).toBe(1);
    expect(instanceReloadCount).toBe(1);

    const manifest = JSON.parse(await readFile(join(cwd, 'vibecanvas.json'), 'utf8'));
    await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({ ...manifest, slug: 'counter-widget-fork' }, null, 2)}\n`, 'utf8');

    const forkResult = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      editSession,
      actorService: {
        reload: async () => { reloadCount += 1 },
        reloadDefinitionInstances: async () => { instanceReloadCount += 1 },
      },
    }), { confirm: true });

    expect(forkResult.isError).toBeUndefined();
    expect(reloadCount).toBe(2);
    expect(instanceReloadCount).toBe(1);
    expect(JSON.parse(await readFile(join(finalWidgetsDir, 'counter-widget-fork', 'vibecanvas.json'), 'utf8')).slug).toBe('counter-widget-fork');
  });
});

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
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
    await executeTool(createApproveActorCandidateTool({ cwd, sessionManager }), { revision: 1 });

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
});

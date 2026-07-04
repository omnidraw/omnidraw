import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApproveActorCandidateTool } from '../src/tools/tool.approve-actor-candidate';
import { createSetActorCandidateTool } from '../src/tools/tool.set-actor-candidate';
import type { TToolEvent } from '../src/tools/types';
import { createFakeSessionManager, executeTool, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('vc_approve_actor_candidate', () => {
  test('writes deterministic scaffold and emits widgetupdate', async () => {
    const cwd = await makeTempDir();
    const events: TToolEvent[] = [];
    const sessionManager = createFakeSessionManager();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate: sampleCandidate() });

    const result = await executeTool(createApproveActorCandidateTool({ cwd, sessionManager, onEvent: (event) => { events.push(event) } }), { revision: 1 });

    expect(result.isError).toBeUndefined();
    expect(result.details.files).toContain('vibecanvas.json');
    expect(result.details.files).toContain('actor/functions.ts');
    expect(result.details.files).toContain('actor/tx.increment.ts');
    expect(events.some((event) => event.type === 'widgetupdate')).toBe(true);
    expect(sessionManager.entries.at(-1)).toMatchObject({
      type: 'custom',
      customType: 'vibecanvas.actorCandidateApproved',
      data: { candidateRevision: 1 },
    });

    const manifest = JSON.parse(await readFile(join(cwd, 'vibecanvas.json'), 'utf8'));
    expect(manifest.name).toBe('Counter Widget');

    const registry = await readFile(join(cwd, 'actor', 'functions.ts'), 'utf8');
    expect(registry).toContain('"tx.increment"');
  });
});

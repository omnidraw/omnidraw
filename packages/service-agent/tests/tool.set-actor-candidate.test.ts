import { describe, expect, test } from 'bun:test';
import { createSetActorCandidateTool } from '../src/tools/tool.set-actor-candidate';
import type { CustomEntry } from '@earendil-works/pi-coding-agent';
import type { TActorCandidateRecord, TToolEvent } from '../src/tools/types';
import { createFakeSessionManager, executeTool, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('vc_set_actor_candidate', () => {
  test('validates, stores, and emits actor candidate revisions', async () => {
    const cwd = await makeTempDir();
    const events: TToolEvent[] = [];
    const sessionManager = createFakeSessionManager();
    const tool = createSetActorCandidateTool({ cwd, sessionManager, onEvent: (event) => { events.push(event) } });

    const result = await executeTool(tool, { candidate: sampleCandidate(), changeSummary: 'initial counter' });

    expect(result.isError).toBeUndefined();
    expect(result.details.revision).toBe(1);
    expect(result.details.manifest.name).toBe('Counter Widget');
    expect(result.details.manifest.slug).toBe('counter-widget');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('actorCandidateChanged');

    const stored = sessionManager.entries.at(-1) as CustomEntry<TActorCandidateRecord> | undefined;
    expect(stored?.type).toBe('custom');
    expect(stored?.data).toMatchObject({
      revision: 1,
      candidate: { widget: { tool: { label: 'Counter' } } },
    });
  });

  test('rejects invalid actor candidates without writing state', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const tool = createSetActorCandidateTool({ cwd, sessionManager });
    const invalid = sampleCandidate({
      actor: {
        ...sampleCandidate().actor,
        initialData: { count: 'bad' },
      },
    });

    const result = await executeTool(tool, { candidate: invalid });

    expect(result.isError).toBe(true);
    expect(result.details.validation.ok).toBe(false);
    expect(sessionManager.entries).toHaveLength(0);
  });
});

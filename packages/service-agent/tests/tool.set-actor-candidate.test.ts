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

  test('allows timout system messages as error recovery handlers without input schema', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const tool = createSetActorCandidateTool({ cwd, sessionManager });
    const base = sampleCandidate();
    const candidate = sampleCandidate({
      actor: {
        ...base.actor,
        states: {
          ready: base.actor.states.ready,
          error: {
            on: {
              'timout:500ms': {
                func: ['tx.resetError'],
                targetState: 'ready',
              },
            },
          },
        },
        inputMsgSchema: {
          'in.increment': base.actor.inputMsgSchema?.['in.increment'] ?? true,
        },
      },
    });

    const result = await executeTool(tool, { candidate });

    expect(result.isError).toBeUndefined();
    expect(result.details.validation.ok).toBe(true);
  });

  test('requires an error state with a recovery handler', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const tool = createSetActorCandidateTool({ cwd, sessionManager });
    const { error: _error, ...statesWithoutError } = sampleCandidate().actor.states;
    const invalid = sampleCandidate({
      actor: {
        ...sampleCandidate().actor,
        states: statesWithoutError,
      },
    });

    const result = await executeTool(tool, { candidate: invalid });

    expect(result.isError).toBe(true);
    expect(result.details.validation.errors).toContain('actor.states.error is required because transition failures implicitly move actors to the base error state');
    expect(sessionManager.entries).toHaveLength(0);
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

  test('rejects invalid lucid icon keys', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const tool = createSetActorCandidateTool({ cwd, sessionManager });
    const base = sampleCandidate();
    const invalid = sampleCandidate({
      widget: {
        tool: {
          ...base.widget.tool,
          icon: { lucidIcon: 'not-a-lucide-icon' },
        },
      },
    });

    const result = await executeTool(tool, { candidate: invalid });

    expect(result.isError).toBe(true);
    expect(result.details.validation.ok).toBe(false);
    expect(result.details.validation.errors.some((error: string) => error.includes('widget.tool.icon.lucidIcon'))).toBe(true);
    expect(sessionManager.entries).toHaveLength(0);
  });

  test('validates and preserves resource requirements in actor candidates', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const tool = createSetActorCandidateTool({ cwd, sessionManager });
    const base = sampleCandidate();
    const candidate = sampleCandidate({
      actor: {
        ...base.actor,
        resources: {
          storage: { kind: 'kv', required: true, scope: ['read', 'write'] },
          credentials: { kind: 'secretStore', required: true, scope: ['read'] },
          notes: {
            kind: 'db',
            required: true,
            scope: ['read'],
            schema: { id: 'notes', version: 0 },
            operations: {
              listNotes: {
                effect: 'read',
                sql: 'SELECT id, title FROM notes',
                result: 'rows',
              },
            },
          },
        },
      },
    });

    const result = await executeTool(tool, { candidate });

    expect(result.isError).toBeUndefined();
    expect(result.details.manifest.actor.resources).toEqual({
      storage: { kind: 'kv', required: true, scope: ['read', 'write'] },
      credentials: { kind: 'secretStore', required: true, scope: ['read'] },
      notes: {
        kind: 'db',
        required: true,
        scope: ['read'],
        schema: { id: 'notes', version: 0 },
        arbitrarySql: false,
        operations: {
          listNotes: {
            effect: 'read',
            sql: 'SELECT id, title FROM notes',
            result: 'rows',
          },
        },
      },
    });
  });

  test('rejects invalid named database operations in actor candidates', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const tool = createSetActorCandidateTool({ cwd, sessionManager });
    const base = sampleCandidate();
    const candidate = sampleCandidate({
      actor: {
        ...base.actor,
        resources: {
          notes: {
            kind: 'db',
            required: true,
            scope: ['read'],
            schema: { id: 'notes', version: 1 },
            operations: {
              mutate: {
                effect: 'write',
                sql: 'DELETE FROM notes; DROP TABLE notes',
                result: 'execute',
              },
            },
          },
        },
      },
    });

    const result = await executeTool(tool, { candidate });

    expect(result.isError).toBe(true);
    expect(result.details.validation.ok).toBe(false);
    expect(result.details.validation.errors.some((error: string) => error.includes('actor.resources.notes'))).toBe(true);
    expect(sessionManager.entries).toHaveLength(0);
  });
});

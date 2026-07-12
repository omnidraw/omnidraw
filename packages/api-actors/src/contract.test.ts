import { describe, expect, test } from 'bun:test';
import { ActorResourceError } from '@vibecanvas/service-actor/resources/ActorResourceError';
import { withActorResourceApiError } from './api.resource-error';
import { ZActorEvent, ZActorResource, ZActorResourceScope, ZCreateActorResourceInput } from './contract';

describe('ZActorEvent', () => {
  test('accepts revisioned actor snapshot events', () => {
    expect(ZActorEvent.safeParse({
      kind: 'system',
      actorId: 'actor-1',
      type: 'snapshot',
      revision: 2,
      state: 'busy.counting',
      data: { ticks: 4 },
      cause: 'activity',
      jobId: 'job-2',
    }).success).toBe(true);
  });

  test('rejects invalid snapshot revisions and causes', () => {
    expect(ZActorEvent.safeParse({
      kind: 'system',
      actorId: 'actor-1',
      type: 'snapshot',
      revision: 0,
      state: 'ready',
      data: {},
      cause: 'timer',
    }).success).toBe(false);
  });
});

describe('actor resource contracts', () => {
  test('accepts generic lifecycle-only resource rows', () => {
    expect(ZActorResource.parse({
      id: 'resource-1',
      kind: 'secretStore',
      name: 'GitHub token',
      status: 'ready',
      last_error: null,
      created_at: '2026-07-11T00:00:00.000Z',
      updated_at: '2026-07-11T00:00:00.000Z',
    })).toMatchObject({ id: 'resource-1', kind: 'secretStore', status: 'ready' });
  });

  test('requires kind-specific resource creation input', () => {
    expect(ZCreateActorResourceInput.parse({ kind: 'kv', name: 'Preferences' })).toEqual({
      kind: 'kv',
      name: 'Preferences',
    });
    expect(ZCreateActorResourceInput.safeParse({
      kind: 'kv',
      name: 'Preferences',
      db: { schemaId: 'notes', version: 1 },
    }).success).toBe(false);
    expect(ZCreateActorResourceInput.safeParse({ kind: 'db', name: 'Notes' }).success).toBe(false);
    expect(ZCreateActorResourceInput.safeParse({
      kind: 'db',
      name: 'Notes',
      db: { schemaId: 'notes', version: 0 },
    }).success).toBe(true);
    expect(ZCreateActorResourceInput.safeParse({ kind: 'secretStore', name: '   ' }).success).toBe(false);
  });

  test('requires a non-empty duplicate-free permission scope', () => {
    expect(ZActorResourceScope.safeParse([]).success).toBe(false);
    expect(ZActorResourceScope.safeParse(['read', 'read']).success).toBe(false);
    expect(ZActorResourceScope.parse(['read', 'write'])).toEqual(['read', 'write']);
  });

  test('preserves stable safe resource codes through the ORPC error envelope', async () => {
    const sentinel = 'must-not-leak';
    try {
      await withActorResourceApiError(async () => {
        throw new ActorResourceError('RESOURCE_STILL_BOUND', 'Resource remains bound.', {
          bindingCount: 2,
          token: sentinel,
        });
      });
      throw new Error('Expected resource error');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'ACTOR_RESOURCE_ERROR',
        message: 'Resource remains bound.',
        data: { code: 'RESOURCE_STILL_BOUND', details: { bindingCount: 2 } },
      });
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });
});

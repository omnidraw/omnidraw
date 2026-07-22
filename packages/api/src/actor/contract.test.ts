import { describe, expect, test } from 'bun:test';
import { actorsContract, ZActorEvent } from './contract';

describe('ZActorEvent', () => {
  test('exposes compatibility-only actor route groups', () => {
    expect(Object.keys(actorsContract)).toEqual(['definitions', 'events', 'instances']);
  });

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

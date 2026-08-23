import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { layerResourceAuthoritySim } from '../sim/layer.domain-authorities.sim';
import { runResourcesConformance } from './resources.suite';

describe('resources simulation conformance', () => {
  test('runs the shared core program with deterministic identity/time', async () => {
    const result = await Effect.runPromise(runResourcesConformance().pipe(Effect.provide(
      layerResourceAuthoritySim({ createdAtSec: '1970-01-01 00:00:00' }),
    )));
    expect(result).toEqual({ resourceId: 'resource-1', count: 1, conflictCode: 'RESOURCE_NAME_CONFLICT' });
  });
});

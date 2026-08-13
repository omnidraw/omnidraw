import { describe, expect, test } from 'bun:test';
import { runResourcesConformance } from './resources.suite';
import { createLiveMechanicsConformanceRuntime } from './tests/live-mechanics.fixture';

describe('resources live conformance', () => {
  test('runs the shared core program through the scoped production database/resource graph', async () => {
    const fixture = await createLiveMechanicsConformanceRuntime('resources-live');
    try {
      const result = await fixture.runtime.runPromise(runResourcesConformance());
      expect(result.count).toBe(1);
      expect(result.conflictCode).toBe('RESOURCE_NAME_CONFLICT');
      expect(result.resourceId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await fixture.dispose();
    }
  });
});

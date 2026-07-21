import { describe, expect, test } from 'bun:test';
import { actorsContract } from '../actor/contract';
import { actorsHandlers } from '../actor/handlers';
import { resourceContract } from './contract';
import { resourceHandlers } from './handlers';

const RESOURCE_GROUPS = [
  'resources',
  'dbResources',
  'dbRows',
  'dbDrafts',
  'dbApplies',
  'dbBackups',
];

function collectProcedurePaths(node: object, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (value === null || typeof value !== 'object') return [];
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    return '~orpc' in value ? [path] : collectProcedurePaths(value, path);
  });
}

describe('neutral resource API contract', () => {
  test('publishes the same six groups and 39 procedures', () => {
    expect(Object.keys(resourceContract)).toEqual(RESOURCE_GROUPS);
    expect(Object.keys(resourceHandlers)).toEqual(RESOURCE_GROUPS);
    expect(collectProcedurePaths(resourceContract)).toHaveLength(39);
    expect(collectProcedurePaths(resourceHandlers).toSorted())
      .toEqual(collectProcedurePaths(resourceContract).toSorted());
  });

  test('keeps legacy actor routes as aliases of the neutral contract and handlers', () => {
    for (const group of RESOURCE_GROUPS) {
      const key = group as keyof typeof resourceContract;
      expect(collectProcedurePaths(actorsContract[key]))
        .toEqual(collectProcedurePaths(resourceContract[key]));
      expect(actorsHandlers[key]).toBe(resourceHandlers[key]);
    }
  });
});

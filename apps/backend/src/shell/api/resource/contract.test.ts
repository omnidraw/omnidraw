import { describe, expect, test } from 'bun:test';
import { resourceContract } from './contract';
import { resourceHandlers } from './handlers';
import { PrivateProcedure, PrivateProcedureContract } from '../procedure';

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
    return value instanceof PrivateProcedureContract || value instanceof PrivateProcedure
      ? [path]
      : collectProcedurePaths(value, path);
  });
}

describe('neutral resource API contract', () => {
  test('publishes the same six groups and 35 procedures', () => {
    expect(Object.keys(resourceContract)).toEqual(RESOURCE_GROUPS);
    expect(Object.keys(resourceHandlers)).toEqual(RESOURCE_GROUPS);
    expect(collectProcedurePaths(resourceContract)).toHaveLength(35);
    expect(collectProcedurePaths(resourceHandlers).toSorted())
      .toEqual(collectProcedurePaths(resourceContract).toSorted());
  });
});

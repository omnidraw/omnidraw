import { describe, expect, test } from 'bun:test';
import { apiContract, contract } from './contract';
import { handlers } from './handlers';
import { router } from './router';

const ROUTE_KEYS = [
  'agent',
  'canvas',
  'db',
  'file',
  'function',
  'notification',
  'resource',
  'tool',
  'widget',
];

function collectProcedurePaths(node: object, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (value === null || typeof value !== 'object') return [];
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    return '~orpc' in value ? [path] : collectProcedurePaths(value, path);
  });
}

describe('unified API route equivalence', () => {
  test('preserves existing route keys and exposes neutral resource, function, and widget routes', () => {
    expect(Object.keys(contract)).toEqual(ROUTE_KEYS);
    expect(Object.keys(apiContract.api)).toEqual(ROUTE_KEYS);
    expect(Object.keys(handlers)).toEqual(ROUTE_KEYS);
    expect(Object.keys(router.api)).toEqual(ROUTE_KEYS);
  });

  test('implements every unified contract procedure', () => {
    const contractProcedures = collectProcedurePaths(apiContract);
    const handlerProcedures = collectProcedurePaths(router);

    expect(contractProcedures).toHaveLength(113);
    expect(handlerProcedures.toSorted()).toEqual(contractProcedures.toSorted());
  });
});

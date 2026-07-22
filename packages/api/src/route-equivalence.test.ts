import { describe, expect, test } from 'bun:test';
import { apiContract, contract } from './contract';
import { handlers } from './handlers';
import { router } from './router';

const ROUTE_KEYS = [
  'actors',
  'agent',
  'canvas',
  'db',
  'file',
  'filesystem',
  'function',
  'notification',
  'pty',
  'resource',
  'tool',
];

function collectProcedurePaths(node: object, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (value === null || typeof value !== 'object') return [];
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    return '~orpc' in value ? [path] : collectProcedurePaths(value, path);
  });
}

describe('unified API route equivalence', () => {
  test('preserves the existing route keys and adds the neutral resource route', () => {
    expect(Object.keys(contract)).toEqual(ROUTE_KEYS);
    expect(Object.keys(apiContract.api)).toEqual(ROUTE_KEYS);
    expect(Object.keys(handlers)).toEqual(ROUTE_KEYS);
    expect(Object.keys(router.api)).toEqual(ROUTE_KEYS);
  });

  test('implements the existing routes, neutral resource aliases, and three function procedures', () => {
    const contractProcedures = collectProcedurePaths(apiContract);
    const handlerProcedures = collectProcedurePaths(router);

    expect(contractProcedures).toHaveLength(173);
    expect(handlerProcedures.toSorted()).toEqual(contractProcedures.toSorted());
  });
});

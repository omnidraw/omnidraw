import { describe, expect, test } from 'bun:test';
import { apiContract, contract } from './contract';
import { handlers } from './handlers';
import { router } from './router';
import { PrivateProcedure, PrivateProcedureContract } from './procedure';

const ROUTE_KEYS = [
  'agent',
  'canvas',
  'db',
  'file',
  'function',
  'notification',
  'resource',
  'widget',
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

describe('unified API route equivalence', () => {
  test('exposes only the current neutral API domains', () => {
    expect(Object.keys(contract)).toEqual(ROUTE_KEYS);
    expect(Object.keys(apiContract.api)).toEqual(ROUTE_KEYS);
    expect(Object.keys(handlers)).toEqual(ROUTE_KEYS);
    expect(Object.keys(router.api)).toEqual(ROUTE_KEYS);
  });

  test('implements every unified contract procedure', () => {
    const contractProcedures = collectProcedurePaths(apiContract);
    const handlerProcedures = collectProcedurePaths(router);

    expect(contractProcedures).toHaveLength(93);
    expect(handlerProcedures.toSorted()).toEqual(contractProcedures.toSorted());
  });
});

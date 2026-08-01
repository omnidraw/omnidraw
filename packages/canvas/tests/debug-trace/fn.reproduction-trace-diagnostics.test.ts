import { describe, expect, test } from 'vitest';
import {
  fnReproductionTraceDiagnostics,
} from '../../src/debug-trace/fn.reproduction-trace-diagnostics';

describe('fnReproductionTraceDiagnostics', () => {
  test('excludes the trace composition outside development', () => {
    expect(fnReproductionTraceDiagnostics({
      development: false,
      buildMode: 'production',
    })).toBe(false);
  });

  test('uses explicit development identity and honest unknown defaults', () => {
    expect(fnReproductionTraceDiagnostics({
      development: true,
      buildMode: 'development',
      cangineVersion: '0.6.0',
    })).toEqual({
      reproductionTrace: true,
      applicationVersion: 'unknown',
      buildMode: 'development',
      cangineVersion: '0.6.0',
    });
  });
});

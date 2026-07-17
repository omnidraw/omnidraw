import { describe, expect, test } from 'bun:test';
import { fnAssertSafeSearchPattern } from '../src/workspace/fn.safe-search-pattern';

describe('bounded search patterns', () => {
  test('accepts the supported linear subset', () => {
    expect(() => fnAssertSafeSearchPattern('^widget\\s+main$')).not.toThrow();
    expect(() => fnAssertSafeSearchPattern('^[A-Z]+\\.ts$')).not.toThrow();
    expect(() => fnAssertSafeSearchPattern('colou?r')).not.toThrow();
  });

  test('rejects constructs that can trigger unbounded backtracking', () => {
    expect(() => fnAssertSafeSearchPattern('(a+)+$')).toThrow('groups');
    expect(() => fnAssertSafeSearchPattern('a+a+$')).toThrow('at most one');
    expect(() => fnAssertSafeSearchPattern('a?a?a?')).toThrow('at most one');
    expect(() => fnAssertSafeSearchPattern('(a|aa)+$')).toThrow('groups');
    expect(() => fnAssertSafeSearchPattern('(a+)\\1')).toThrow('groups');
    expect(() => fnAssertSafeSearchPattern('a+$')).toThrow('anchored');
  });
});

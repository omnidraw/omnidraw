import { describe, expect, test } from 'bun:test';
import { fnBoundToolModelData, fnToolError, fnToolSuccess } from '../src/tools/fn.result';

describe('tool result helpers', () => {
  test('renders explicit safe model data without serializing details', () => {
    const result = fnToolSuccess({
      summary: 'Listed resources.',
      modelData: { resources: [{ name: 'Preferences', kind: 'kv' }], nextCursor: null },
      details: { hostOnly: 'details-sentinel' },
    });
    expect(result.content[0]?.text).toContain('"name": "Preferences"');
    expect(result.content[0]?.text).toContain('"nextCursor": null');
    expect(result.content[0]?.text).not.toContain('details-sentinel');
    expect(result.details).toEqual({ hostOnly: 'details-sentinel' });
  });

  test('renders stable errors as structured provider-visible data', () => {
    const result = fnToolError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource was not found.',
      retryable: false,
      modelData: { resourceName: 'Missing' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"code": "RESOURCE_NOT_FOUND"');
    expect(result.content[0]?.text).toContain('"message": "Resource was not found."');
    expect(result.content[0]?.text).toContain('"resourceName": "Missing"');
  });

  test('bounds strings, arrays, and whole rendered payloads deterministically', () => {
    const bounded = fnBoundToolModelData({
      text: 'x'.repeat(40_000),
      items: Array.from({ length: 700 }, (_, index) => index),
    });
    expect(bounded.truncated).toBe(true);
    expect((bounded.data as any).text).toEndWith('[truncated]');
    expect((bounded.data as any).items).toHaveLength(500);
    const result = fnToolSuccess({ summary: 'Bounded.', modelData: bounded.data });
    expect(result.content[0]?.text.length).toBeLessThan(130_000);
  });
});

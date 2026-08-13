import { describe, expect, test } from 'bun:test';
import {
  fnBoundToolModelData,
  fnIsStructuredToolErrorDetails,
  fnToolError,
  fnToolSuccess,
  fnToolSuccessWithPng,
} from '../tools/fn.result';

const SYNTHETIC_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==';

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
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(fnIsStructuredToolErrorDetails(result.details)).toBe(true);
    expect(fnIsStructuredToolErrorDetails(fnToolSuccess({
      summary: 'Tool error.\n\nModel data:\nThis is successful file content.',
    }).details)).toBe(false);
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

  test('builds one text part followed by one bounded PNG without duplicating its data', () => {
    const details = { inspectionId: 'inspection-1', dimensions: { width: 2, height: 2 } };
    const result = fnToolSuccessWithPng({
      summary: 'Synthetic image transport proof.',
      modelData: { inspected: true },
      details,
      image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
    });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Synthetic image transport proof.\n\nModel data:\n{\n  "inspected": true\n}',
        },
        { type: 'image', mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
      ],
      details,
    });
    expect(result.details).toBe(details);
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '')
      .not.toContain(SYNTHETIC_PNG_BASE64);
    expect(JSON.stringify(result.details)).not.toContain(SYNTHETIC_PNG_BASE64);
    expect(JSON.stringify(result.content).split(SYNTHETIC_PNG_BASE64)).toHaveLength(2);
  });

  test('rejects malformed PNG results and image-data copies outside the image block', () => {
    expect(() => fnToolSuccessWithPng({
      summary: 'Wrong MIME.',
      image: { mimeType: 'image/jpeg', data: SYNTHETIC_PNG_BASE64 } as never,
    })).toThrow('unsupported-mime-type');
    expect(() => fnToolSuccessWithPng({
      summary: 'Bad signature.',
      image: { mimeType: 'image/png', data: `A${SYNTHETIC_PNG_BASE64.slice(1)}` },
    })).toThrow('invalid-png-signature');
    expect(() => fnToolSuccessWithPng({
      summary: `Duplicate summary: ${SYNTHETIC_PNG_BASE64}`,
      image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
    })).toThrow('must only appear in the image content block');
    expect(() => fnToolSuccessWithPng({
      summary: 'Duplicate model data.',
      modelData: { nested: { raw: SYNTHETIC_PNG_BASE64 } },
      image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
    })).toThrow('must only appear in the image content block');
    expect(() => fnToolSuccessWithPng({
      summary: 'Duplicate details.',
      details: { raw: `prefix:${SYNTHETIC_PNG_BASE64}:suffix` },
      image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
    })).toThrow('must only appear in the image content block');
    expect(() => fnToolSuccessWithPng({
      summary: 'Duplicate details key.',
      details: { [SYNTHETIC_PNG_BASE64]: true },
      image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
    })).toThrow('must only appear in the image content block');
  });
});

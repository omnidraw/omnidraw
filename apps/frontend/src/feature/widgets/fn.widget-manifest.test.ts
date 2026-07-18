import { describe, expect, test } from 'vitest';
import type { TWidgetDetail } from '@vibecanvas/orpc-client';
import { fnWidgetMessageRows } from './fn.widget-manifest';

describe('fnWidgetMessageRows', () => {
  test('sorts declared messages and maps inputs to accepting states', () => {
    const manifest = {
      actor: {
        inputMsgSchema: { toggle: { type: 'object' }, add: { type: 'string' } },
        outputMsgSchema: { changed: { type: 'object' } },
        states: {
          ready: { on: { toggle: {}, add: {} } },
          busy: { on: { toggle: {} } },
        },
      },
    } as unknown as NonNullable<TWidgetDetail['manifest']>;
    expect(fnWidgetMessageRows(manifest)).toEqual({
      inputs: [
        { name: 'add', schema: { type: 'string' }, acceptedInStates: ['ready'] },
        { name: 'toggle', schema: { type: 'object' }, acceptedInStates: ['busy', 'ready'] },
      ],
      outputs: [{ name: 'changed', schema: { type: 'object' } }],
    });
  });

  test('returns empty rows without a valid manifest', () => {
    expect(fnWidgetMessageRows(null)).toEqual({ inputs: [], outputs: [] });
  });
});

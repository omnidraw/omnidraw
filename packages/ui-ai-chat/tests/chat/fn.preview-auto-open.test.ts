import { describe, expect, test } from 'vitest';
import {
  fnFirstAutoOpenWidgetPreviewReference,
  fnNormalizeAutoOpenedPreviewDraftIds,
  fnRecordAutoOpenedPreviewDraftId,
} from '../../src/chat/components/fn.preview-auto-open';

function draftId(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function widgetCreateResult(id: string, name: string) {
  return {
    role: 'toolResult',
    toolCallId: `create-${id}`,
    toolName: 'od_widget_create',
    content: [{ type: 'text', text: `Created ${name}.` }],
    details: {
      draftId: id,
      name,
      source: 'draft',
      draft: true,
    },
  };
}

describe('automatic Preview companion selection', () => {
  test('selects only the first trusted finished widget-create result', () => {
    const first = widgetCreateResult(draftId(1), 'Shared Timer');
    const second = widgetCreateResult(draftId(2), 'Team Notes');

    expect(fnFirstAutoOpenWidgetPreviewReference(
      [{ role: 'assistant', content: [{ type: 'text', text: 'Created one.' }] }, first, second],
      [],
    )).toEqual({
      draftId: draftId(1),
      name: 'Shared Timer',
    });
    expect(fnFirstAutoOpenWidgetPreviewReference(
      [first, second],
      [draftId(1)],
    )).toBeUndefined();
  });

  test('normalizes persisted IDs to a unique bounded list', () => {
    const candidates = [
      'not-a-draft-id',
      draftId(1),
      draftId(1),
      ...Array.from({ length: 20 }, (_, index) => draftId(index + 2)),
    ];

    const normalized = fnNormalizeAutoOpenedPreviewDraftIds(candidates);

    expect(normalized).toHaveLength(16);
    expect(normalized[0]).toBe(draftId(1));
    expect(new Set(normalized).size).toBe(normalized.length);
    expect(normalized).not.toContain('not-a-draft-id');
    expect(fnRecordAutoOpenedPreviewDraftId(normalized, draftId(99))).toEqual([
      ...normalized.slice(1),
      draftId(99),
    ]);
  });
});

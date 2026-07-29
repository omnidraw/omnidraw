import { describe, expect, test } from 'vitest';
import {
  fnProjectPreviewLogEntry,
  fnRetainPreviewLogEntries,
  type TPreviewLogEntry,
} from '../../src/canvas-extension/fn.preview-log';

describe('Preview log projection', () => {
  test('projects ordered build and displayed-revision context', () => {
    const entry = fnProjectPreviewLogEntry({
      sequence: 7,
      event: {
        kind: 'build',
        phase: 'superseded',
        revision: 'b'.repeat(64),
        buildSequence: 12,
        displayed: {
          revision: 'a'.repeat(64),
          bindingRevision: 4,
        },
      },
    });

    expect(entry).toEqual({
      sequence: 7,
      source: 'build',
      level: 'warning',
      message: 'Build bbbbbbbb superseded… Showing aaaaaaaa • bindings #4',
      buildSequence: 12,
      truncated: false,
    });
  });

  test('bounds and sanitizes individual entry text', () => {
    const entry = fnProjectPreviewLogEntry({
      sequence: 1,
      maxMessageLength: 24,
      event: {
        kind: 'diagnostic',
        code: 'GUEST_FAILURE',
        message: `unsafe\u0000 ${'x'.repeat(80)}`,
        occurrenceCount: 3,
      },
    });

    expect(entry.message).toHaveLength(24);
    expect(entry.message).not.toContain('\u0000');
    expect(entry.message.endsWith('…')).toBe(true);
    expect(entry.truncated).toBe(true);
  });

  test('orders entries, replaces duplicate sequence numbers, and bounds retention', () => {
    const entry = (
      sequence: number,
      message = String(sequence),
    ): TPreviewLogEntry => ({
      sequence,
      source: 'lifecycle',
      level: 'info',
      message,
      buildSequence: null,
      truncated: false,
    });
    let entries: readonly TPreviewLogEntry[] = [];
    for (const sequence of [3, 1, 2, 4]) {
      entries = fnRetainPreviewLogEntries({
        entries,
        entry: entry(sequence),
        maxEntries: 3,
      });
    }
    entries = fnRetainPreviewLogEntries({
      entries,
      entry: entry(3, 'replacement'),
      maxEntries: 3,
    });

    expect(entries.map(({ sequence, message }) => ({ sequence, message })))
      .toEqual([
        { sequence: 2, message: '2' },
        { sequence: 3, message: 'replacement' },
        { sequence: 4, message: '4' },
      ]);
  });
});
